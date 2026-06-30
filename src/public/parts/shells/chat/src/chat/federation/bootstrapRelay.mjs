/**
 * 联邦房间凭证 口令 bootstrap：离线/轮换后向邻居索要当前传输密钥。
 */
import { randomUUID } from 'node:crypto'

import { isHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { decryptUtf8ForMember, encryptUtf8ForMember } from '../../../../../../../scripts/p2p/key_crypto.mjs'
import { pickFederationTargetPeerIds } from '../../../../../../../scripts/p2p/peer_pool.mjs'
import { resolveLocalEventSigner } from '../dag/localSigner.mjs'
import { eventsPath } from '../lib/paths.mjs'

import {
	setFederationBootstrap,
	setPeerRoomHint,
} from './bootstrapStore.mjs'
import { federationNodeHash, loadFederationGroupSettings, loadFederationMaterializedState, requireDagDeps } from './deps.mjs'
import { catchUpGroupFromPeers } from './index.mjs'
import { invalidateFederationRoomCache } from './room.mjs'
import { roomCredentialsFromGroupSettings } from './roomCredentials.mjs'
import { markRoomCredentialsStale } from './roomCredentialsStale.mjs'

/** @type {Map<string, { createdAt: number }>} */
const recentBootstrapRequests = new Map()

const REQUEST_COOLDOWN_MS = 45_000

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {string} 冷却去重键
 */
function bootstrapCooldownKey(username, groupId) {
	return `${username}\0${groupId}`
}

/** 重导出 bootstrap wire 解析函数。 */
export { parseFedBootstrapRequest, parseFedBootstrapResponse } from './bootstrap/wire.mjs'

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} nodeHash 本机 nodeHash
 * @param {object} request 解析后的 bootstrap 请求
 * @param {string} peerId 请求方 Trystero peer
 * @param {(payload: unknown, peerId: string) => void} sendResponse 发送响应
 * @returns {Promise<void>}
 */
export async function handleFedBootstrapRequest(username, groupId, nodeHash, request, peerId, sendResponse) {
	if (request.groupId !== groupId) return
	const state = await loadFederationMaterializedState(username, groupId)
	if (state?.members?.[request.requesterPubKeyHash]?.status !== 'active') return

	const creds = roomCredentialsFromGroupSettings(state.groupSettings)
	if (!creds?.roomSecret) return

	let settingsEventId
	const { readJsonl } = requireDagDeps()
	const events = await readJsonl(eventsPath(username, groupId))
	for (let index = events.length - 1; index >= 0; index--) {
		const event = events[index]
		if (event?.type === 'group_settings_update' && event.content?.roomSecret === creds.roomSecret) {
			settingsEventId = event.id
			break
		}
	}

	const memberPubHex = state.members[request.requesterPubKeyHash].pubKeyHex
	if (!isHex64(memberPubHex)) return
	sendResponse({
		requestId: request.requestId,
		responderNodeHash: nodeHash,
		settingsEventId,
		encryptedRoomSecret: encryptUtf8ForMember(JSON.stringify({
			signalingAppId: creds.signalingAppId,
			roomSecret: creds.roomSecret,
		}), memberPubHex),
	}, peerId)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} response 解析后的 bootstrap 响应
 * @returns {Promise<boolean>} 是否已应用
 */
export async function applyFedBootstrapResponse(username, groupId, response) {
	const plain = decryptUtf8ForMember(response.encryptedRoomSecret, (await resolveLocalEventSigner(username, groupId)).secretKey)
	if (!plain) return false

	const parsed = JSON.parse(plain)
	if (!parsed.roomSecret) return false

	const creds = {
		signalingAppId: parsed.signalingAppId || 'fount-group-fed',
		roomSecret: String(parsed.roomSecret),
		settingsEventId: response.settingsEventId,
	}

	setPeerRoomHint(username, groupId, {
		...creds,
		fromNodeId: response.responderNodeHash,
	})
	setFederationBootstrap(username, groupId, creds)
	invalidateFederationRoomCache(username, groupId)
	void catchUpGroupFromPeers(username, groupId, {
		waitMs: 2000,
		extraWantIds: creds.settingsEventId ? [creds.settingsEventId] : undefined,
	})
	return true
}

/**
 * @param {object} slot FederationSlot
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} nodeHash 本机 nodeHash
 * @param {string} requesterPubKeyHash 本机成员 pubKeyHash
 * @param {string} [localTipsHash] 本地 tips 摘要
 * @returns {Promise<void>}
 */
export async function broadcastFedBootstrapRequest(slot, username, groupId, nodeHash, requesterPubKeyHash, localTipsHash) {
	const cooldownKey = bootstrapCooldownKey(username, groupId)
	const previous = recentBootstrapRequests.get(cooldownKey)
	if (previous && Date.now() - previous.createdAt < REQUEST_COOLDOWN_MS) return
	recentBootstrapRequests.set(cooldownKey, { createdAt: Date.now() })
	if (recentBootstrapRequests.size > 500) {
		const now = Date.now()
		for (const [key, entry] of recentBootstrapRequests)
			if (now - entry.createdAt > REQUEST_COOLDOWN_MS * 4) recentBootstrapRequests.delete(key)
	}

	const groupSettings = await loadFederationGroupSettings(username, groupId)
	const targets = await pickFederationTargetPeerIds(groupId,
		slot.getRoster(),
		groupSettings,
		nodeHash,
	)
	const body = {
		requestId: randomUUID(),
		nodeHash,
		groupId,
		requesterPubKeyHash,
		localTipsHash,
	}
	if (!targets.length) slot.send('fed_bootstrap_request', body, null)
	else for (const peerId of targets) slot.send('fed_bootstrap_request', body, peerId)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} catchupResult catchUp 统计
 * @param {object | null} slot 联邦槽
 * @returns {Promise<void>}
 */
export async function maybeRequestBootstrapAfterCatchup(username, groupId, catchupResult, slot) {
	const syncFailed = catchupResult.tipsCollected > 0
		&& catchupResult.eventsFilled === 0
		&& catchupResult.wantIds > 0
	if (!syncFailed) return

	markRoomCredentialsStale(username, groupId)
	if (!slot) return

	const nodeHash = federationNodeHash(username)
	const { sender: requesterPubKeyHash } = await resolveLocalEventSigner(username, groupId)
	await broadcastFedBootstrapRequest(slot, username, groupId, nodeHash, requesterPubKeyHash)
}
