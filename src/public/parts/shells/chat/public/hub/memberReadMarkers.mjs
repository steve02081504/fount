/**
 * 【文件】public/hub/memberReadMarkers.mjs
 * 【职责】拉取并缓存频道成员已读水位；己方消息角标用「是否有人已读」判定双勾；WS read_marker 增量更新后刷 DOM。
 * 【API】GET …/groups/:id/channels/:cid/member-read-markers → `{ markers: { [entityHash]: { seq, eventId } } }`
 */
import { geti18n } from '../../../../scripts/i18n/index.mjs'
import { hubDeliveryReadIcon } from '../src/lib/emojiSvg.mjs'

import { hubStore } from './core/state.mjs'

/** @type {Map<string, Record<string, { seq: number, eventId: string }>>} channelKey → markers */
const markersCache = new Map()

/**
 * 构建缓存键。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @returns {string} 缓存键
 */
function cacheKey(groupId, channelId) {
	return `${groupId}:${channelId}`
}

/**
 * 拉取指定频道的成员已读水位并写入缓存，随后刷新可见己方消息角标。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<Record<string, { seq: number, eventId: string }>>} 成员已读水位映射
 */
export async function fetchMemberReadMarkers(groupId, channelId) {
	try {
		const response = await fetch(
			`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/member-read-markers`,
			{ credentials: 'include' },
		)
		if (!response.ok) return {}
		const { markers = {} } = await response.json()
		markersCache.set(cacheKey(groupId, channelId), markers)
		paintOwnDeliveryStatuses()
		return markers
	}
	catch { return {} }
}

/**
 * 获取缓存的成员已读水位（同步）。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @returns {Record<string, { seq: number, eventId: string }>} 成员已读水位映射
 */
export function getCachedReadMarkers(groupId, channelId) {
	return markersCache.get(cacheKey(groupId, channelId)) ?? {}
}

/**
 * WS `read_marker` 增量更新缓存。
 * @param {{ groupId?: string, channelId?: string, entityHash?: string, readMarker?: { eventId?: string, seq?: number } }} wireMessage WS 载荷
 * @returns {void}
 */
export function applyMemberReadMarkerWire(wireMessage) {
	const groupId = String(wireMessage.groupId || '').trim()
	const channelId = String(wireMessage.channelId || '').trim()
	const entityHash = String(wireMessage.entityHash || '').trim().toLowerCase()
	const seq = Number(wireMessage.readMarker?.seq)
	const eventId = String(wireMessage.readMarker?.eventId || '').trim().toLowerCase()
	if (!groupId || !channelId || !entityHash || !Number.isFinite(seq)) return
	const key = cacheKey(groupId, channelId)
	const markers = { ...getCachedReadMarkers(groupId, channelId) }
	const prev = markers[entityHash]
	if (prev && Number(prev.seq) >= seq) return
	markers[entityHash] = { seq, eventId }
	markersCache.set(key, markers)
	if (groupId === hubStore.context.currentGroupId && channelId === hubStore.context.currentChannelId)
		paintOwnDeliveryStatuses()
}

/**
 * 对方是否已读（任一其他成员水位覆盖该消息）。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {number} msgSeq 消息 seq
 * @returns {boolean} 是否有任一其他成员水位覆盖该消息
 */
export function isMessageReadByPeer(groupId, channelId, msgSeq) {
	const markers = getCachedReadMarkers(groupId, channelId)
	const viewerKey = String(hubStore.context.currentState?.viewerMemberPubKeyHash
		|| hubStore.context.currentState?.viewerEntityHash
		|| '').trim().toLowerCase()
	for (const [entityHash, marker] of Object.entries(markers)) {
		if (entityHash.toLowerCase() === viewerKey) continue
		if (marker.seq >= msgSeq) return true
	}
	return false
}

/**
 * 将可见己方消息角标升为「别人已读」双勾（仅 sent → read，不回退）。
 * @returns {void}
 */
export function paintOwnDeliveryStatuses() {
	const groupId = hubStore.context.currentGroupId
	const channelId = hubStore.context.currentChannelId
	if (!groupId || !channelId) return
	const container = document.getElementById('hub-messages')
	if (!(container instanceof HTMLElement)) return
	const readTitle = geti18n('chat.hub.deliveryRead') || ''
	for (const msg of hubStore.messages.channelMessagesSource) {
		if (msg.isRemote || msg.pending || msg.sendFailed) continue
		const seq = Number(msg.seq)
		if (!Number.isFinite(seq) || seq <= 0) continue
		if (!isMessageReadByPeer(groupId, channelId, seq)) continue
		const eventId = String(msg.eventId || '')
		if (!eventId) continue
		const domRow = container.querySelector(`[data-message-id="${CSS.escape(eventId)}"]`)
		const existing = domRow?.querySelector('.hub-delivery-status')
		if (!(existing instanceof HTMLElement)) continue
		if (existing.classList.contains('hub-delivery-status--read')) continue
		existing.className = 'hub-delivery-status hub-delivery-status--read text-xs opacity-70'
		existing.title = readTitle
		existing.innerHTML = hubDeliveryReadIcon
		if (domRow instanceof HTMLElement) domRow.dataset.deliveryStatus = 'read'
	}
}
