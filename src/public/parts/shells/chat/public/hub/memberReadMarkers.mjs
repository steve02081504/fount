/**
 * 【文件】public/hub/memberReadMarkers.mjs
 * 【职责】拉取并缓存频道成员已读水位，对己方消息渲染已读数角标；WS read_marker 增量更新缓存。
 * 【API】GET …/groups/:id/channels/:cid/member-read-markers → `{ markers: { [entityHash]: { seq, eventId } } }`
 */
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
 * 拉取指定频道的成员已读水位并写入缓存。
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
		const data = await response.json()
		const markers = data?.markers && typeof data.markers === 'object' ? data.markers : {}
		markersCache.set(cacheKey(groupId, channelId), markers)
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
}

/**
 * 返回某条己方消息的已读成员数（排除自己）。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {number} msgSeq 消息 seq（view-log 行里的 seq 字段）
 * @returns {number} 已读成员数
 */
export function getReadCountForMessage(groupId, channelId, msgSeq) {
	const markers = getCachedReadMarkers(groupId, channelId)
	const viewerKey = String(hubStore.context.currentState?.viewerMemberPubKeyHash
		|| hubStore.context.currentState?.viewerEntityHash
		|| '').trim().toLowerCase()
	let count = 0
	for (const [entityHash, marker] of Object.entries(markers)) {
		if (entityHash.toLowerCase() === viewerKey) continue
		if (typeof marker.seq === 'number' && marker.seq >= msgSeq) count++
	}
	return count
}

/**
 * 对方是否已读（DM / 单人水位比较）。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {number} msgSeq 消息 seq
 * @returns {boolean} 是否有任一其他成员水位覆盖该消息
 */
export function isMessageReadByPeer(groupId, channelId, msgSeq) {
	return getReadCountForMessage(groupId, channelId, msgSeq) > 0
}
