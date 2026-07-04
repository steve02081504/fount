/**
 * 【文件】federation/volatile.mjs
 * 【职责】将群 WebSocket 上的 VOLATILE 类消息（流分片、信誉 slash 告警）经 fed_volatile 中继到稀疏联邦邻居，并在入站时转回本群 WS。
 * 【原理】publishVolatileToFederation 由 groupWsBroadcast 在广播后调用，仅当 groupFederationOwner 存在且联邦启用；信封含 nodeId、dedupeId、payload。入站验签 stream_chunk、去重后 broadcastEvent 带 fedInbound 防回环。优先级 10 在 outbound 队列最先被丢弃。
 * 【数据结构】FED_VOLATILE_WS_TYPES；信封 { nodeId, groupId, dedupeId, payload }。
 * 【关联】stream/groupWsHub、groupWsBroadcast、signing.mjs、reputation.mjs、room.mjs、registry groupFederationOwner。
 */
import { createHash } from 'node:crypto'

import { applyVolatileSlashAlert } from '../../../../../../../scripts/p2p/reputation.mjs'
import { isPlainObject } from '../../../../../../../scripts/p2p/wire_ingress.mjs'

import { federationNodeHash, loadFederationGroupSettings } from './deps.mjs'
import { groupFederationOwner } from './registry.mjs'

/** 经联邦中继的 WS VOLATILE 类型（§6.4）。 */
const FED_VOLATILE_WS_TYPES = new Set([
	'stream_chunk',
	'reputation_slash_alert',
])

const FED_VOLATILE_DEDUPE_MS = 8_000
/** @type {Map<string, number>} */
const fedVolatileDedupe = new Map()

/**
 * @param {object | null | undefined} payload WS 广播体
 * @returns {boolean} 是否应经联邦 VOLATILE 中继
 */
export function isFederableVolatilePayload(payload) {
	if (payload?.fedInbound) return false
	return FED_VOLATILE_WS_TYPES.has(payload?.type)
}

/**
 * @param {string} dedupeKey 去重键
 * @returns {boolean} 首次见到为 true
 */
function takeFedVolatileDedupe(dedupeKey) {
	const now = Date.now()
	if (fedVolatileDedupe.size > 4000)
		for (const [key, expiresAt] of fedVolatileDedupe)
			if (expiresAt < now - FED_VOLATILE_DEDUPE_MS) fedVolatileDedupe.delete(key)
	if (fedVolatileDedupe.has(dedupeKey)) return false
	fedVolatileDedupe.set(dedupeKey, now)
	return true
}

/**
 * 将本机 WS VOLATILE 中继到稀疏联邦邻居。
 * @param {string} groupId 群 ID
 * @param {object} payload 与 `broadcastEvent` 相同的业务体
 * @returns {Promise<void>}
 */
export async function publishVolatileToFederation(groupId, payload) {
	if (!isFederableVolatilePayload(payload)) return
	const username = groupFederationOwner.get(groupId)
	if (!username) return

	const channelId = String(payload?.channelId || '').trim() || undefined
	const { resolveFederationSlotForAction } = await import('./room.mjs')
	const slot = await resolveFederationSlotForAction(username, groupId, {
		actionName: 'fed_volatile',
		channelId,
	})
	if (!slot?.send) return

	const nodeHash = federationNodeHash(username)
	const groupSettings = await loadFederationGroupSettings(username, groupId)

	const { pickFederationTargetPeerIds } = await import('../../../../../../../scripts/p2p/peer_pool.mjs')
	const targets = await pickFederationTargetPeerIds(groupId,
		slot.getRoster?.() || [],
		groupSettings,
		nodeHash,
	)
	const dedupeId = createHash('sha256')
		.update(JSON.stringify({ type: payload.type, ...payload }))
		.digest('hex')
		.slice(0, 24)
	const envelope = { nodeHash, groupId, dedupeId, payload }
	if (!targets.length) {
		slot.send('fed_volatile',envelope, null)
		return
	}
	for (const peerId of targets)
		slot.send('fed_volatile',envelope, peerId)
}

/**
 * 入站 `fed_volatile`：验重后转本群 WS。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {unknown} data 信封
 * @param {string} peerId Trystero peer
 * @param {Map<string, string>} peerToNode peer → nodeId
 * @param {(subject: string) => boolean} isBlockedPeer 节点拉黑检查
 * @returns {Promise<void>}
 */
export async function handleIncomingFedVolatile(username, groupId, data, peerId, peerToNode, isBlockedPeer) {
	const envelopeNode = String(data?.nodeHash || '').trim()
	if (!isPlainObject(data) || data.groupId !== groupId || !envelopeNode || !data.dedupeId || !data.payload) return
	const envelope = data
	const { payload } = envelope
	if (!isFederableVolatilePayload(payload)) return

	const nodeHash = federationNodeHash(username)
	if (envelopeNode === nodeHash) return

	const remoteNodeHash = peerToNode.get(peerId) || envelopeNode
	if (remoteNodeHash && isBlockedPeer(remoteNodeHash)) return
	if (envelopeNode && isBlockedPeer(envelopeNode)) return

	const dedupeKey = `${String(envelopeNode || remoteNodeHash)}:${String(envelope.dedupeId || '')}`
	if (!takeFedVolatileDedupe(dedupeKey)) return

	const { verifyStreamChunkVolatile } = await import('../stream/signing.mjs')
	if (!await verifyStreamChunkVolatile(payload)) return

	if (payload.type === 'reputation_slash_alert') {
		await applyVolatileSlashAlert(payload)
		return
	}

	const { broadcastEvent } = await import('../stream/groupWsHub.mjs')
	const { groupWsRoomKeyForReplica } = await import('../stream/groupWsRooms.mjs')
	broadcastEvent(groupWsRoomKeyForReplica(groupId), { ...payload, fedInbound: true })
}
