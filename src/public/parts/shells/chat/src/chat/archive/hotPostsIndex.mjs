/**
 * checkpoint `hot_posts` 纯函数索引（无 I/O）。
 */
import { archiveSettingsFromGroup } from './settings.mjs'

/**
 * @param {object} overlay messageOverlay
 * @param {string} channelId 频道 ID
 * @returns {string[]} 置顶 eventId 列表
 */
export function overlayPinsForChannel(overlay, channelId) {
	const pins = overlay?.pins
	if (!pins) return []
	if (pins instanceof Map) return pins.get(channelId) || []
	return pins[channelId] || []
}

/**
 * @param {object} row 事件或消息行
 * @returns {number} wall 毫秒
 */
function rowWallMs(row) {
	return Number(row.hlc?.wall)
}

/**
 * @param {object[]} events DAG 事件
 * @param {string} channelId 频道 ID
 * @returns {object[]} 该频道 message 事件（时间升序）
 */
export function listChannelMessageEvents(events, channelId) {
	return events
		.filter(ev => ev.type === 'message' && String(ev.channelId || 'default') === channelId)
		.sort((a, b) => {
			const wa = rowWallMs(a)
			const wb = rowWallMs(b)
			if (wa !== wb) return wa - wb
			return String(a.id).localeCompare(String(b.id))
		})
}

/**
 * @param {object} state 物化状态
 * @param {object[]} events DAG 事件
 * @param {object} [groupSettings] 群设置
 * @returns {{ latestByChannel: Record<string, string[]>, pinContexts: Record<string, Record<string, string[]>> }} hot_posts 索引
 */
export function recomputeHotPostIndex(state, events, groupSettings = {}) {
	const { hotLatest, pinContext } = archiveSettingsFromGroup(groupSettings)
	/** @type {Record<string, string[]>} */
	const latestByChannel = {}
	/** @type {Record<string, Record<string, string[]>>} */
	const pinContexts = {}
	for (const channelId of Object.keys(state.channels || {})) {
		const ordered = listChannelMessageEvents(events, channelId)
		const ids = ordered.map(ev => ev.id)
		latestByChannel[channelId] = hotLatest > 0 ? ids.slice(-hotLatest) : []
		const pins = overlayPinsForChannel(state.messageOverlay, channelId)
		if (!pinContexts[channelId]) pinContexts[channelId] = {}
		for (const pinId of pins) {
			const pinNorm = String(pinId).trim().toLowerCase()
			const idx = ids.findIndex(id => String(id).trim().toLowerCase() === pinNorm)
			if (idx < 0) continue
			const start = Math.max(0, idx - pinContext)
			const end = Math.min(ids.length, idx + pinContext + 1)
			pinContexts[channelId][pinNorm] = ids.slice(start, end)
		}
	}
	return { latestByChannel, pinContexts }
}

/**
 * @param {object} hotPosts hot_posts
 * @param {string} channelId 频道 ID
 * @returns {string[]} 热区窗口 eventId
 */
function hotWindowIdsForChannel(hotPosts, channelId) {
	return hotPosts?.latestByChannel?.[channelId] || []
}

/**
 * @param {object} hotPosts hot_posts 索引
 * @param {string} channelId 频道 ID
 * @returns {Set<string>} 受保护 eventId
 */
export function protectedHotEventIds(hotPosts, channelId) {
	const set = new Set()
	for (const id of hotWindowIdsForChannel(hotPosts, channelId)) set.add(id)
	const pinMap = hotPosts?.pinContexts?.[channelId] || {}
	for (const ids of Object.values(pinMap))
		for (const id of ids) set.add(id)
	return set
}

/**
 * @param {object} hotPosts hot_posts
 * @returns {Set<string>} 全部热区 eventId
 */
export function allProtectedHotEventIds(hotPosts) {
	const set = new Set()
	for (const channelId of Object.keys(hotPosts?.latestByChannel || {}))
		for (const id of protectedHotEventIds(hotPosts, channelId)) set.add(id)
	for (const channelId of Object.keys(hotPosts?.pinContexts || {}))
		for (const id of protectedHotEventIds(hotPosts, channelId)) set.add(id)
	return set
}
