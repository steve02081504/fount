/**
 * 【文件】readMarkers.mjs — 每用户每频道已读水位（seq + eventId）。
 * 【职责】读写 `shells/chat/readMarkers.json`；计算频道/群未读数。
 * 【原理】未读 = channel.messageSeq - marker.seq；O(1) 依赖物化 state 上的 messageSeq。
 */
import { assignShellData, loadShellData } from '../../../../../../../server/setting_loader.mjs'

const DATANAME = 'readMarkers'

/**
 * @param {string} username 用户
 * @returns {Record<string, Record<string, { eventId: string, seq: number }>>} groupId → channelId → marker
 */
export function loadReadMarkers(username) {
	return loadShellData(username, 'chat', DATANAME)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {{ eventId: string, seq: number } | null} 已读水位
 */
export function getChannelReadMarker(username, groupId, channelId) {
	const markers = loadReadMarkers(username)
	return markers[groupId]?.[channelId] ?? null
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {{ eventId: string, seq: number }} marker 已读水位
 * @returns {void}
 */
export function setChannelReadMarker(username, groupId, channelId, marker) {
	const markers = loadReadMarkers(username)
	markers[groupId] ??= {}
	const prev = markers[groupId][channelId]
	const nextSeq = Number(marker.seq)
	if (prev && Number(prev.seq) >= nextSeq) return
	markers[groupId][channelId] = {
		eventId: String(marker.eventId).trim().toLowerCase(),
		seq: nextSeq,
	}
	assignShellData(username, 'chat', DATANAME, markers)
}

/**
 * @param {object} channelState 物化频道条目
 * @param {{ seq?: number } | null} marker 已读水位
 * @returns {number} 未读条数
 */
export function channelUnreadCount(channelState, marker) {
	const messageSeq = Number(channelState?.messageSeq) || 0
	const readSeq = Number(marker?.seq) || 0
	return Math.max(0, messageSeq - readSeq)
}

/**
 * @param {object} state 物化群 state
 * @param {Record<string, { eventId: string, seq: number }>} groupMarkers 本群各频道 marker
 * @returns {{ unreadCount: number, channelUnread: Record<string, number> }} 群总未读与各频道未读映射
 */
export function summarizeGroupUnread(state, groupMarkers = {}) {
	/** @type {Record<string, number>} */
	const channelUnread = {}
	let unreadCount = 0
	for (const [channelId, channel] of Object.entries(state.channels || {})) {
		const count = channelUnreadCount(channel, groupMarkers[channelId])
		if (count > 0) channelUnread[channelId] = count
		unreadCount += count
	}
	return { unreadCount, channelUnread }
}

/**
 * 从频道 JSONL 行推导下一条 message seq（落盘前调用）。
 * @param {object[]} existingLines 已有消息行
 * @returns {number} 下一条 seq
 */
export function nextChannelMessageSeq(existingLines) {
	let maxSeq = 0
	let messageCount = 0
	for (const row of existingLines) {
		if (row.type !== 'message') continue
		messageCount++
		const seq = Number(row.seq)
		if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq
	}
	return maxSeq > 0 ? maxSeq + 1 : messageCount + 1
}
