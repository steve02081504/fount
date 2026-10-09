import { isDagEventId } from '../../src/lib/eventId.mjs'
import { store } from '../core/state.mjs'
import { activePrivateCharPartName } from '../friendBindings.mjs'

import {
	mergeIncrementalSourceBatch,
	refreshChannelMessagesView,
} from './channelMessageStore.mjs'
import { getMessageText } from './render/text.mjs'

/** 反应映射稳定签名（新增/移除任一 emoji 或投票者都会变化），实现见 reactionSignature.mjs。 */
export { reactionsSignature } from './reactionSignature.mjs'

/** view-log 单页条数：首屏、增量刷新与上翻历史共用同一分页大小。 */
export const CHANNEL_VIEW_LOG_PAGE_SIZE = 50

/** @returns {void} */
export function refreshChannelView() {
	refreshChannelMessagesView(getMessageText)
	const dividerId = store.messages.firstUnreadEventId
	if (!dividerId) return
	const { channelMessages } = store.messages
	const idx = channelMessages.findIndex(row => row.eventId === dividerId)
	if (idx <= 0) return
	if (channelMessages[idx - 1]?.type === 'unread_divider') return
	store.messages.channelMessages = [
		...channelMessages.slice(0, idx),
		{ type: 'unread_divider', eventId: `unread:${dividerId}` },
		...channelMessages.slice(idx),
	]
}

/**
 * @param {HTMLElement} container 消息列表容器
 * @returns {void}
 */
export function clearHubEmptyPlaceholder(container) {
	if (container?.querySelector('.empty')) container.innerHTML = ''
}

/**
 * 记录最后一条真实 DAG 消息 id（跳过到达序在尾部的乐观 pending 行，避免把 `pending:` 当增量游标）。
 * @returns {void}
 */
export function updateLastMessageId() {
	const lastDagRow = store.messages.channelMessagesSource.findLast(row => isDagEventId(row?.eventId))
	store.messages.lastMessageId = lastDagRow?.eventId ?? null
}

/**
 * @param {import('./channelMessageStore.mjs').ChannelMessageSource} source 当前源列表
 * @param {object[]} batch 增量批次
 * @returns {import('./channelMessageStore.mjs').ChannelMessageSource} 合并后的源列表
 */
export function mergeIncrementalChannelBatch(source, batch) {
	const pendingId = store.messages.composerPendingId
	const merged = mergeIncrementalSourceBatch(source, batch)
	if (pendingId && !merged.some(row => String(row.eventId) === pendingId))
		store.messages.composerPendingId = null
	return merged
}

/** @returns {boolean} 是否为双方角色对话（好友角色私聊，或单角色且活跃成员≤2） */
export function isTwoPartyCharDialogue() {
	// 私聊对端语义；charlist 是否含该角色另见 activeCharPartNames / session.chars
	if (activePrivateCharPartName()) return true
	const state = store.context.currentState
	if (!state) return false
	const charCount = state.charPartNames?.length ?? 0
	const activeMembers = Object.values(state.members).filter(member => member?.status === 'active').length
	return charCount === 1 && activeMembers <= 2
}

/**
 * @param {string} messageId 消息 eventId
 * @returns {string} CSS 选择器
 */
export function messageIdSelector(messageId) {
	if (!messageId) return ''
	const escaped = CSS.escape(messageId)
	return `[data-message-id="${escaped}"]`
}

/**
 * @param {string} messageId 消息 eventId
 * @returns {string} 消息行 CSS 选择器（排除反应条等同 id 节点）
 */
export function hubMessageRowSelector(messageId) {
	const idSel = messageIdSelector(messageId)
	return idSel ? `.message${idSel}` : ''
}
