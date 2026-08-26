/**
 * 联邦房间凭证 口令 bootstrap：离线/轮换后向邻居索要当前传输密钥。
 */
import { randomUUID } from 'node:crypto'

import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { decryptUtf8ForMember, encryptUtf8ForMember } from 'npm:@steve02081504/fount-p2p/crypto/key'

import { handleError } from 'fount/scripts/errorHandlers.mjs'


import { resolveLocalEventSigner } from '../dag/localSigner.mjs'
import { eventsPath } from '../lib/paths.mjs'

import {
	setFederationBootstrap,
} from './bootstrapStore.mjs'
import { localNodeHash, loadFederationGroupSettings, loadFederationMaterializedState, requireDagDeps } from './dagDependencies.mjs'
import { catchUpGroupFromPeers } from './index.mjs'
import { LOGIC_SYNC_PARTITION } from './partitions.mjs'
import { pickFederationTargetPeerIds } from './peerFanout.mjs'
import { getFederationPartitionSlot } from './registry.mjs'
import { invalidateFederationRoomCache } from './room.mjs'
import { roomCredentialsFromGroupSettings } from './roomCredentials.mjs'

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

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} nodeHash 本机 nodeHash
 * @param {object} request 解析后的 bootstrap 请求
 * @param {string} peerId 请求方 peer
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
		signalingAppId: parsed.signalingAppId,
		roomSecret: parsed.roomSecret,
		settingsEventId: response.settingsEventId,
	}

	setFederationBootstrap(username, groupId, {
		...creds,
		fromNodeId: response.responderNodeHash,
	})

	const existingSlot = getFederationPartitionSlot(username, groupId, LOGIC_SYNC_PARTITION)
	const dagCreds = roomCredentialsFromGroupSettings(
		(await loadFederationMaterializedState(username, groupId))?.groupSettings,
	)
	const slotAlreadyMatches = existingSlot?.roomSecret === creds.roomSecret
	const dagAlreadyMatches = dagCreds?.roomSecret === creds.roomSecret

	// 口令未变时切勿 invalidate+rejoin：会断已有 WebRTC 且 offerPool 在负载下难以重握手。
	if (slotAlreadyMatches) {
		if (dagAlreadyMatches) {
			const { clearFederationBootstrap } = await import('./bootstrapStore.mjs')
			clearFederationBootstrap(username, groupId)
		}
		catchUpGroupFromPeers(username, groupId, {
			waitMs: 2000,
			extraWantIds: creds.settingsEventId ? [creds.settingsEventId] : undefined,
		}).catch(handleError)
		return true
	}

	invalidateFederationRoomCache(username, groupId)
	catchUpGroupFromPeers(username, groupId, {
		waitMs: 2000,
		extraWantIds: creds.settingsEventId ? [creds.settingsEventId] : undefined,
	}).catch(handleError)
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

	const activeSlot = slot || getFederationPartitionSlot(username, groupId, LOGIC_SYNC_PARTITION)
	if (!activeSlot) return

	const nodeHash = localNodeHash()
	const { sender: requesterPubKeyHash } = await resolveLocalEventSigner(username, groupId)
	await broadcastFedBootstrapRequest(activeSlot, username, groupId, nodeHash, requesterPubKeyHash)
}
