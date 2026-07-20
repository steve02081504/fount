/**
 * 【文件】public/hub/messages/pinPreview.mjs
 * 【职责】置顶/引用消息的预览摘要：拉取目标事件、缓存描述字段并生成模板插值。
 * 【原理】为置顶条与消息内 pin 卡片提供 `pinPreviewTemplateFields` 展示字段。`resolvePinMessagePreview` 解析被引用消息文本/Markdown 摘要；`clearPinPreviewCache` 在换频道时失效。
 * 【数据结构】store 及模块内 Map/Set 字段；见 core/state 与各函数 JSDoc。
 * 【关联】channelMessageStore、../core/domUtils、../core/state、render/text
 */
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { store } from '../core/state.mjs'

import { fetchRowsForMessageEvent } from './channelMessageStore.mjs'
import { getMessageText } from './render/text.mjs'

/** @type {Map<string, { i18n?: string, params?: Record<string, string>, text?: string }>} */
const previewCache = new Map()

/**
 * @param {string} eventId 事件 id
 * @returns {string} 短 id
 */
function shortEventId(eventId) {
	return eventId.length > 10 ? `${eventId.slice(0, 8)}…` : eventId
}

/**
 * @param {{ i18n?: string, params?: Record<string, string>, text?: string }} descriptor 预览描述
 * @returns {{ previewText: string, previewI18nAttr: string }} 模板字段
 */
export function pinPreviewTemplateFields(descriptor) {
	if (descriptor?.i18n) {
		const paramAttrs = Object.entries(descriptor.params || {})
			.map(([k, v]) => ` data-${k}="${escapeHtml(String(v))}"`)
			.join('')
		return { previewText: '', previewI18nAttr: ` data-i18n="${descriptor.i18n}"${paramAttrs}` }
	}
	return { previewText: escapeHtml(descriptor?.text || ''), previewI18nAttr: '' }
}

/**
 * @param {object} message 消息行
 * @returns {{ i18n?: string, params?: Record<string, string>, text?: string }} 摘要描述
 */
function previewFromMessage(message) {
	const text = getMessageText(message).trim().replace(/\s+/gu, ' ')
	if (!text) return { text: '' }
	const type = message?.content?.type
	if (type === 'sticker') return { i18n: 'chat.hub.pinPreviewSticker' }
	if (type === 'vote') {
		const question = message.content?.question || ''
		return { i18n: 'chat.hub.pinPreviewVote', params: { question } }
	}
	if (type === 'group_invite') {
		const groupName = message.content?.groupName || ''
		return { i18n: 'chat.hub.pinPreviewInvite', params: { groupName } }
	}
	return { text: text.length > 40 ? `${text.slice(0, 40)}…` : text }
}

/**
 * 解析置顶/书签消息摘要（当前频道走缓存，其余拉取频道消息列表）。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} eventId 事件 id
 * @returns {Promise<{ i18n?: string, params?: Record<string, string>, text?: string }>} 展示用摘要
 */
export async function resolvePinMessagePreview(groupId, channelId, eventId) {
	const normalizedEventId = String(eventId).trim()
	if (!normalizedEventId) return { text: '' }
	const cacheKey = `${groupId}:${channelId}:${normalizedEventId}`
	const cached = previewCache.get(cacheKey)
	if (cached) return cached

	if (groupId === store.context.currentGroupId && channelId === store.context.currentChannelId) {
		const message = store.messages.channelMessages.find(row => String(row.eventId) === normalizedEventId)
		const descriptor = message ? previewFromMessage(message) : { text: '' }
		if (descriptor.text || descriptor.i18n) {
			previewCache.set(cacheKey, descriptor)
			return descriptor
		}
	}

	try {
		const rows = await fetchRowsForMessageEvent(groupId, channelId, normalizedEventId)
		const message = rows.find(row => String(row.eventId) === normalizedEventId)
		const descriptor = message ? previewFromMessage(message) : { text: shortEventId(normalizedEventId) }
		previewCache.set(cacheKey, descriptor)
		return descriptor
	}
	catch {
		const descriptor = { text: shortEventId(normalizedEventId) }
		previewCache.set(cacheKey, descriptor)
		return descriptor
	}
}

/**
 * 群切换时清空跨群摘要缓存。
 * @returns {void}
 */
export function clearPinPreviewCache() {
	previewCache.clear()
}
