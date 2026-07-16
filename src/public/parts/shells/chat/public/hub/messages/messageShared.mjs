import { hubStore } from '../core/state.mjs'

import {
	mergeIncrementalSourceBatch,
	refreshChannelMessagesView,
} from './channelMessageStore.mjs'
import { getMessageText } from './render/text.mjs'

/**
 * @param {Record<string, Record<string, { voters?: string[] }>> | undefined} reactions 反应映射
 * @returns {string} 稳定序列化签名
 */
export function reactionsSignature(reactions) {
	if (!reactions || !Object.keys(reactions).length) return ''
	return JSON.stringify(reactions, Object.keys(reactions).sort())
}

/** @returns {void} */
export function refreshChannelView() {
	refreshChannelMessagesView(getMessageText)
	const dividerId = hubStore.messages.firstUnreadEventId
	if (!dividerId) return
	const channelMessages = hubStore.messages.channelMessages
	const idx = channelMessages.findIndex(row => row.eventId === dividerId)
	if (idx <= 0) return
	if (channelMessages[idx - 1]?.type === 'unread_divider') return
	hubStore.messages.channelMessages = [
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
	if (container?.querySelector('.hub-empty')) container.innerHTML = ''
}

/** @returns {void} */
export function updateLastMessageId() {
	const last = hubStore.messages.channelMessagesSource.at(-1)
	hubStore.messages.lastMessageId = last?.eventId || null
}

/**
 * @param {import('./channelMessageStore.mjs').ChannelMessageSource} source 当前源列表
 * @param {object[]} batch 增量批次
 * @returns {import('./channelMessageStore.mjs').ChannelMessageSource} 合并后的源列表
 */
export function mergeIncrementalChannelBatch(source, batch) {
	const pendingId = hubStore.messages.composerPendingId
	const merged = mergeIncrementalSourceBatch(source, batch, pendingId)
	if (pendingId && batch.some(row => String(row.eventId) !== pendingId))
		hubStore.messages.composerPendingId = null
	return merged
}

/** @returns {boolean} 是否为双方角色对话 */
export function isTwoPartyCharDialogue() {
	if (hubStore.privateGroup.charname) return true
	const state = hubStore.context.currentState
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
	const eventId = String(messageId || '')
	if (!eventId) return ''
	const escaped = CSS.escape(eventId)
	return `[data-message-id="${escaped}"]`
}

/**
 * @param {string} messageId 消息 eventId
 * @returns {string} 消息行 CSS 选择器（排除反应条等同 id 节点）
 */
export function hubMessageRowSelector(messageId) {
	const idSel = messageIdSelector(messageId)
	return idSel ? `.hub-message${idSel}` : ''
}
