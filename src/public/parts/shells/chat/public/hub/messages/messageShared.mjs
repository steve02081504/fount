import { hubStore } from '../core/state.mjs'

import {
	mergeIncrementalSourceBatch,
	refreshChannelMessagesView,
} from './channelMessageStore.mjs'
import { getMessageText } from './messageRender.mjs'

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
