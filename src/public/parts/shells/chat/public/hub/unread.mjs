/**
 * 【文件】hub/unread.mjs — 未读 badge 与 read-marker 同步。
 */
import { groupFetch, groupPath } from '../src/api/groupClient.mjs'

import { hubStore } from './core/state.mjs'

/**
 * @param {Record<string, number>} channelUnread 频道未读映射
 * @returns {number} 群未读总数
 */
function sumChannelUnread(channelUnread) {
	return Object.values(channelUnread).reduce((sum, n) => sum + (Number(n) || 0), 0)
}

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {{ eventId: string, seq: number }} marker 已读水位
 * @returns {Promise<{ readMarker: { eventId: string, seq: number } }>} 服务端确认后的已读水位
 */
export async function putChannelReadMarker(groupId, channelId, marker) {
	return groupFetch(groupPath(groupId, 'channels', channelId, 'read-marker'), {
		method: 'PUT',
		json: marker,
	})
}

/**
 * @param {number} count 未读数
 * @returns {string} badge HTML；0 时为空
 */
export function formatUnreadBadgeHtml(count) {
	const n = Number(count) || 0
	if (n <= 0) return ''
	const label = n > 99 ? '99+' : String(n)
	return `<span class="hub-unread-badge" aria-label="${label}">${label}</span>`
}

/**
 * @param {string} groupId 群 ID
 * @returns {number} 群未读总数
 */
export function getGroupUnreadCount(groupId) {
	const group = hubStore.sidebar.groups.find(row => row.groupId === groupId)
	return Number(group?.unreadCount) || 0
}

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {number} 频道未读数
 */
export function getChannelUnreadCount(groupId, channelId) {
	const group = hubStore.sidebar.groups.find(row => row.groupId === groupId)
	return Number(group?.channelUnread?.[channelId]) || 0
}

/**
 * 根据 read-marker 与消息列表计算首条未读 eventId。
 * @param {{ seq?: number } | null | undefined} readMarker 已读水位
 * @param {object[]} messages 展示消息列表
 * @returns {string | null} 首条未读 eventId
 */
export function firstUnreadEventId(readMarker, messages) {
	const readSeq = Number(readMarker?.seq) || 0
	for (const row of messages) {
		if (row.type === 'unread_divider') continue
		const seq = Number(row.seq)
		if (Number.isFinite(seq) && seq > readSeq) return row.eventId
	}
	return null
}

/**
 * 当前频道末条可读 message 的 read-marker 载荷。
 * @returns {{ eventId: string, seq: number } | null} 末条可读消息的 marker；无消息时为 null
 */
export function latestReadableMarker() {
	const rows = hubStore.messages.channelMessagesSource.filter(row => row.type === 'message' && row.eventId)
	const last = rows.at(-1)
	if (!last?.eventId || !Number.isFinite(Number(last.seq))) return null
	return { eventId: last.eventId, seq: Number(last.seq) }
}

/**
 * 标记当前频道已读并刷新侧栏 badge。
 * 不清除 `firstUnreadEventId`：本轮打开时的分割线锚点保留到下次 loadMessages。
 * @returns {Promise<void>}
 */
export async function markCurrentChannelRead() {
	const groupId = hubStore.context.currentGroupId
	const channelId = hubStore.context.currentChannelId
	const marker = latestReadableMarker()
	if (!groupId || !channelId || !marker) return
	await putChannelReadMarker(groupId, channelId, marker)
	hubStore.messages.readMarker = marker
	const group = hubStore.sidebar.groups.find(row => row.groupId === groupId)
	if (group?.channelUnread) {
		delete group.channelUnread[channelId]
		group.unreadCount = sumChannelUnread(group.channelUnread)
	}
	void import('./serverBar.mjs').then(({ renderServerBar }) => renderServerBar())
	void import('./sidebar/index.mjs').then(({ renderHubChannelSidebar }) => {
		if (hubStore.context.currentState) void renderHubChannelSidebar(hubStore.context.currentState)
	})
}

/**
 * 处理 WS read_marker（本用户其他端已读同步）。
 * @param {object} wireMessage WS 载荷
 * @returns {void}
 */
export function handleReadMarkerWire(wireMessage) {
	void import('./memberReadMarkers.mjs').then(({ applyMemberReadMarkerWire }) => {
		applyMemberReadMarkerWire(wireMessage)
	})
	const viewerName = hubStore.viewer.username
	if (!wireMessage?.readMarker || wireMessage.username !== viewerName) return
	const { groupId, channelId, readMarker } = wireMessage
	const group = hubStore.sidebar.groups.find(row => row.groupId === groupId)
	if (!group) return
	const channelState = hubStore.context.currentState?.channels?.[channelId]
	const messageSeq = Number(channelState?.messageSeq) || 0
	const readSeq = Number(readMarker?.seq) || 0
	const unread = Math.max(0, messageSeq - readSeq)
	group.channelUnread ??= {}
	if (unread > 0) group.channelUnread[channelId] = unread
	else delete group.channelUnread[channelId]
	group.unreadCount = sumChannelUnread(group.channelUnread)
	if (groupId === hubStore.context.currentGroupId && channelId === hubStore.context.currentChannelId) {
		hubStore.messages.readMarker = readMarker
		hubStore.messages.firstUnreadEventId = null
	}
	void import('./serverBar.mjs').then(({ renderServerBar }) => renderServerBar())
}

/**
 * 收到他频道新消息时 bump 未读。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {void}
 */
export function bumpChannelUnread(groupId, channelId) {
	if (groupId === hubStore.context.currentGroupId && channelId === hubStore.context.currentChannelId) return
	const group = hubStore.sidebar.groups.find(row => row.groupId === groupId)
	if (!group) return
	group.channelUnread ??= {}
	group.channelUnread[channelId] = (Number(group.channelUnread[channelId]) || 0) + 1
	group.unreadCount = (Number(group.unreadCount) || 0) + 1
	void import('./serverBar.mjs').then(({ renderServerBar }) => renderServerBar())
}
