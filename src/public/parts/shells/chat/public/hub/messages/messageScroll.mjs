import { store } from '../core/state.mjs'

import { ensureMessageLoaded, findMessageViewIndex } from './channelMessageStore.mjs'
import { syncChannelActionsContext } from './messageContext.mjs'
import { clearHubEmptyPlaceholder, hubMessageRowSelector, messageIdSelector, refreshChannelView } from './messageShared.mjs'
import { rebuildVirtualListAtEvent } from './messageVirtualList.mjs'

/** @type {HTMLElement | null} */
let cachedMessagesContainer = null

/** 虚拟列表重建后待高亮的 eventId。 */
let pendingHighlightEventId = null

/** @returns {HTMLElement | null} 消息列表容器元素 */
export function getMessagesContainer() {
	if (cachedMessagesContainer?.isConnected) return cachedMessagesContainer
	const el = document.getElementById('messages')
	cachedMessagesContainer = el instanceof HTMLElement ? el : null
	return cachedMessagesContainer
}

/** @returns {string | null} 待高亮 eventId，消费后清空 */
export function consumePendingHighlightEventId() {
	const id = pendingHighlightEventId
	pendingHighlightEventId = null
	return id
}

/** @param {string | null} eventId @returns {void} */
export function setPendingHighlightEventId(eventId) {
	pendingHighlightEventId = eventId
}

/** @returns {void} */
export function scrollToBottom() {
	const container = getMessagesContainer()
	if (!container) return
	container.scrollTop = container.scrollHeight
}

/**
 * @param {HTMLElement} row 消息行元素
 * @returns {void}
 */
export function highlightMessageRow(row) {
	row.scrollIntoView({ behavior: 'smooth', block: 'center' })
	row.classList.add('ring-2', 'ring-primary', 'ring-offset-2')
	setTimeout(() => row.classList.remove('ring-2', 'ring-primary', 'ring-offset-2'), 2000)
}

/**
 *
 */
export { messageIdSelector }

/**
 * @param {string} eventId 目标消息 eventId
 * @returns {Promise<void>}
 */
export async function scrollToMessageEventId(eventId) {
	const norm = String(eventId || '').trim()
	if (!norm) return
	const container = getMessagesContainer()
	if (!container) return

	const sel = hubMessageRowSelector(norm)
	let row = sel ? container.querySelector(sel) : null
	if (row instanceof HTMLElement) {
		highlightMessageRow(row)
		return
	}

	const result = await ensureMessageLoaded(norm)
	if (!result.ok) return

	refreshChannelView()
	syncChannelActionsContext()

	row = sel ? container.querySelector(sel) : null
	if (row instanceof HTMLElement) {
		highlightMessageRow(row)
		return
	}

	if (!store.messages.channelMessages.length) return

	clearHubEmptyPlaceholder(container)

	setPendingHighlightEventId(norm)

	if (findMessageViewIndex(norm) >= 0 && store.messages.channelMessagePipeline) 
		await store.messages.channelMessagePipeline.refresh()
	
	else {
		rebuildVirtualListAtEvent(container, norm)
		if (store.messages.channelMessagePipeline)
			await store.messages.channelMessagePipeline.refresh()
	}

	row = sel ? container.querySelector(sel) : null
	if (row instanceof HTMLElement) {
		setPendingHighlightEventId(null)
		highlightMessageRow(row)
	}
}
