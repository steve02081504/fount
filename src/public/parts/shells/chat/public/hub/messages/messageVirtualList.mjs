import {
	createDocumentFragmentFromHtmlStringNoScriptActivation,
	renderTemplate,
} from '../../../../../scripts/features/template.mjs'
import { getChannelViewLog } from '../../src/api/groupChannel.mjs'
import { eventIdsEqual, normalizeEventId } from '../../src/lib/eventId.mjs'
import { createMessagePipeline } from '../../src/MessagePipeline.mjs'
import { attachLastCharMessageSwipe, updateHideCharNames } from '../chatGestures.mjs'
import { hubStore } from '../core/state.mjs'
import { applyAvatarsTo } from '../presence.mjs'
import { syncStreamingSlotsFromDom } from '../stream/index.mjs'

import { bindChannelMessageActions } from './actions/handlers.mjs'
import {
	consumePendingScrollTarget,
	setPendingScrollTarget,
} from './channelMessageStore.mjs'
import { bindReactions, messageRenderOpts } from './messageContext.mjs'
import { bindMessageDragExport } from './messageDragExport.mjs'
import {
	consumePendingHighlightEventId,
	getMessagesContainer,
	highlightMessageRow,
	messageIdSelector,
	scrollToBottom,
	setPendingHighlightEventId,
} from './messageScroll.mjs'
import { isTwoPartyCharDialogue, refreshChannelView } from './messageShared.mjs'
import {
	localizeRenderedMessages,
	renderChannelMessageBlock,
} from './render/index.mjs'

/** @returns {void} */
export function destroyChannelVirtualList() {
	hubStore.messages.channelMessagePipeline?.destroy()
	hubStore.messages.channelMessagePipeline = null
	hubStore.messages.channelPipelineKey = null
}

/**
 * @param {object} message 消息行
 * @param {number} index 在列表中的索引
 * @returns {Promise<HTMLElement>} 渲染后的消息元素
 */
async function renderChannelMessageElement(message, index) {
	if (message.type === 'unread_divider')
		return renderTemplate('hub/messages/unread_divider', {})
	const prev = index > 0 ? hubStore.messages.channelMessages[index - 1] : null
	const lastId = hubStore.messages.channelMessages.at(-1)?.eventId
	const block = await renderChannelMessageBlock(
		message,
		prev?.type === 'unread_divider' ? null : prev?.charId ?? prev?.sender ?? null,
		prev?.type === 'unread_divider' ? 0 : prev?.timestamp || 0,
		hubStore.messages.channelMessages,
		{ ...messageRenderOpts(), lastMessageEventId: lastId },
	)
	const frag = await createDocumentFragmentFromHtmlStringNoScriptActivation(block.html)
	return frag.firstElementChild
}

/** @type {Promise<number> | null} */
let olderMessagesInFlight = null

/** @returns {Promise<number>} 新载入的更早消息条数 */
export async function loadOlderMessages() {
	if (olderMessagesInFlight) return olderMessagesInFlight
	olderMessagesInFlight = doLoadOlderMessages().finally(() => {
		olderMessagesInFlight = null
	})
	return olderMessagesInFlight
}

/** @returns {Promise<number>} 新载入的更早消息条数 */
async function doLoadOlderMessages() {
	if (hubStore.messages.channelOlderExhausted || !hubStore.context.currentGroupId || !hubStore.context.currentChannelId) return 0
	const oldest = hubStore.messages.channelMessages[0]
	const oldestId = oldest?.eventId
	if (!oldestId || String(oldestId).startsWith('pending:')) {
		hubStore.messages.channelOlderExhausted = true
		return 0
	}
	const limit = Math.max(1, Math.ceil(hubStore.messages.channelMessages.length / 2))
	const known = new Set(
		hubStore.messages.channelMessagesSource.map(m => String(m.eventId)).filter(Boolean),
	)
	let before = oldestId
	let hasMore = true
	let fresh = []
	while (hasMore && !fresh.length) {
		let batch = []
		let oldestRawEventId = null
		try {
			const page = await getChannelViewLog(hubStore.context.currentGroupId, hubStore.context.currentChannelId, {
				before,
				limit,
			})
			batch = page.messages || []
			hasMore = page.hasMore
			oldestRawEventId = page.oldestRawEventId
		}
		catch {
			hubStore.messages.channelOlderExhausted = true
			return 0
		}
		fresh = batch.filter(m => {
			const eventId = String(m.eventId)
			return eventId && !known.has(eventId)
		})
		if (!fresh.length && hasMore && oldestRawEventId && oldestRawEventId !== before)
			before = oldestRawEventId
		else
			break
	}
	if (!hasMore && !fresh.length) {
		hubStore.messages.channelOlderExhausted = true
		return 0
	}
	if (!fresh.length)
		return 0
	hubStore.messages.channelMessagesSource = [...fresh, ...hubStore.messages.channelMessagesSource]
	refreshChannelView()
	const { syncChannelActionsContext } = await import('./messageContext.mjs')
	syncChannelActionsContext()
	return fresh.length
}

/**
 * @param {number} offset 起始偏移
 * @param {number} limit 条数上限
 * @returns {{ items: object[], total: number }} 虚拟列表分页数据
 */
function sliceChannelMessagesPage(offset, limit) {
	if (limit === 0) return { items: [], total: hubStore.messages.channelMessages.length }
	return {
		items: hubStore.messages.channelMessages.slice(offset, offset + limit),
		total: hubStore.messages.channelMessages.length,
	}
}

/**
 * @param {HTMLElement} container 消息列表容器
 * @returns {void}
 */
export function initChannelVirtualList(container) {
	destroyChannelVirtualList()
	/** @returns {void} */
	function onVirtualListRenderComplete() {
		decorateRenderedMessages(container, false)
	}
	hubStore.messages.channelMessagePipeline = createMessagePipeline({
		container,
		loadMoreTop: loadOlderMessages,
		fetchData: sliceChannelMessagesPage,
		renderItem: renderChannelMessageElement,
		/**
		 * @param {object} row 消息行
		 * @returns {string} eventId
		 */
		getItemKey: row => String(row.eventId || ''),
		initialIndex: (() => {
			const targetId = consumePendingScrollTarget()
			if (!targetId) return Math.max(0, hubStore.messages.channelMessages.length - 1)
			const norm = normalizeEventId(targetId)
			const idx = hubStore.messages.channelMessages.findIndex(
				m => eventIdsEqual(m.eventId, norm),
			)
			return idx >= 0 ? idx : Math.max(0, hubStore.messages.channelMessages.length - 1)
		})(),
		/**
		 *
		 */
		onRenderComplete: onVirtualListRenderComplete,
	})
}

/**
 * @param {HTMLElement} container 消息列表容器
 * @param {boolean} [shouldScroll=false] 是否滚动到底部
 * @returns {void}
 */
export function decorateRenderedMessages(container, shouldScroll = false) {
	localizeRenderedMessages(container)
	syncStreamingSlotsFromDom(container)
	applyAvatarsTo(container)
	bindReactions(container)
	bindChannelMessageActions(container)
	bindMessageDragExport(container)
	if (isTwoPartyCharDialogue()) {
		updateHideCharNames(hubStore.messages.channelMessages)
		attachLastCharMessageSwipe(container)
	}
	if (shouldScroll) scrollToBottom()
	const pendingId = consumePendingHighlightEventId()
	if (pendingId) {
		const sel = messageIdSelector(pendingId)
		const row = sel ? container.querySelector(sel) : null
		if (row instanceof HTMLElement)
			highlightMessageRow(row)
	}
}

/**
 * @param {HTMLElement} container 消息列表容器
 * @param {string} eventId 目标 eventId
 * @returns {void}
 */
export function rebuildVirtualListAtEvent(container, eventId) {
	setPendingScrollTarget(eventId)
	destroyChannelVirtualList()
	initChannelVirtualList(container)
	decorateRenderedMessages(container, false)
}

/**
 * @param {string} eventId 目标 eventId
 * @returns {void}
 */
export function queueHighlightAfterRebuild(eventId) {
	setPendingHighlightEventId(eventId)
	rebuildVirtualListAtEvent(getMessagesContainer(), eventId)
}
