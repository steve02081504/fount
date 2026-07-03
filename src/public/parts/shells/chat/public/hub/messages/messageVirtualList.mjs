import {
	createDocumentFragmentFromHtmlStringNoScriptActivation,
} from '../../../../../scripts/features/template.mjs'
import {
	getChannelMessages,
	requestChannelHistoryFromPeers,
} from '../../src/api/groupApi.mjs'
import { eventIdsEqual, normalizeEventId } from '../../src/lib/eventId.mjs'
import { createMessagePipeline } from '../../src/MessagePipeline.mjs'
import { getChatGestures } from '../chatGestures.mjs'
import { hubStore } from '../core/state.mjs'
import { syncStreamingSlotsFromDom } from '../groupStream.mjs'
import { applyAvatarsTo } from '../presence.mjs'

import {
	consumePendingScrollTarget,
	setPendingScrollTarget,
} from './channelMessageStore.mjs'
import { bindChannelMessageActions } from './messageActionsHandlers.mjs'
import { bindReactions, messageRenderOpts } from './messageContext.mjs'
import {
	localizeRenderedMessages,
	renderChannelMessageBlock,
} from './messageRender.mjs'
import {
	consumePendingHighlightEventId,
	getMessagesContainer,
	highlightMessageRow,
	messageIdSelector,
	scrollToBottom,
	setPendingHighlightEventId,
} from './messageScroll.mjs'
import { isTwoPartyCharDialogue, refreshChannelView } from './messageShared.mjs'

/** @returns {void} */
export function destroyChannelVirtualList() {
	hubStore.messages.channelMessagePipeline?.destroy()
	hubStore.messages.channelMessagePipeline = null
}

/**
 * @param {object} message 消息行
 * @param {number} index 在列表中的索引
 * @returns {Promise<HTMLElement>} 渲染后的消息元素
 */
async function renderChannelMessageElement(message, index) {
	const prev = index > 0 ? hubStore.messages.channelMessages[index - 1] : null
	const lastId = hubStore.messages.channelMessages.at(-1)?.eventId
	const block = await renderChannelMessageBlock(
		message,
		prev?.charId ?? prev?.sender ?? null,
		prev?.timestamp || 0,
		hubStore.messages.channelMessages,
		{ ...messageRenderOpts(), lastMessageEventId: lastId },
	)
	const frag = await createDocumentFragmentFromHtmlStringNoScriptActivation(block.html)
	return frag.firstElementChild
}

/** @returns {Promise<number>} 新载入的更早消息条数 */
export async function loadOlderMessages() {
	if (hubStore.messages.channelOlderExhausted || !hubStore.context.currentGroupId || !hubStore.context.currentChannelId) return 0
	const oldest = hubStore.messages.channelMessages[0]
	const oldestId = oldest?.eventId
	if (!oldestId || String(oldestId).startsWith('pending:')) {
		hubStore.messages.channelOlderExhausted = true
		return 0
	}
	const limit = Math.max(1, Math.ceil(hubStore.messages.channelMessages.length / 2))
	let batch = []
	try {
		const { messages } = await getChannelMessages(hubStore.context.currentGroupId, hubStore.context.currentChannelId, {
			before: oldestId,
			limit,
		})
		batch = messages || []
	}
	catch {
		batch = []
	}
	if (!batch.length)
		try {
			batch = await requestChannelHistoryFromPeers(hubStore.context.currentGroupId, hubStore.context.currentChannelId, {
				before: oldestId,
				limit,
			})
		}
		catch {
			batch = []
		}

	if (!batch.length) {
		hubStore.messages.channelOlderExhausted = true
		return 0
	}
	const known = new Set(
		hubStore.messages.channelMessagesSource.map(m => String(m.eventId)).filter(Boolean),
	)
	const fresh = batch.filter(m => {
		const eventId = String(m.eventId)
		return eventId && !known.has(eventId)
	})
	if (!fresh.length) {
		hubStore.messages.channelOlderExhausted = true
		return 0
	}
	hubStore.messages.channelMessagesSource = [...fresh, ...hubStore.messages.channelMessagesSource]
	refreshChannelView()
	const { loadMessages } = await import('./messages.mjs')
	const { syncChannelActionsContext } = await import('./messageContext.mjs')
	syncChannelActionsContext(loadMessages)
	return fresh.length
}

/**
 * @param {number} offset 起始偏移
 * @param {number} limit 条数上限
 * @returns {Promise<{ items: object[], total: number }>} 虚拟列表分页数据
 */
async function fetchVirtualListPage(offset, limit) {
	if (limit === 0) return { items: [], total: hubStore.messages.channelMessages.length }
	return {
		items: hubStore.messages.channelMessages.slice(offset, offset + limit),
		total: hubStore.messages.channelMessages.length,
	}
}

/**
 * @param {object} item 消息行
 * @param {number} index 列表索引
 * @returns {Promise<HTMLElement>} 渲染后的消息元素
 */
function renderVirtualListItem(item, index) {
	return renderChannelMessageElement(item, index)
}

/**
 * @param {HTMLElement} container 消息列表容器
 * @param {() => Promise<void>} reload 重载消息回调
 * @returns {() => void} 渲染完成回调
 */
function createVirtualListRenderComplete(container, reload) {
	return () => decorateRenderedMessages(container, false, reload)
}

/**
 * @param {HTMLElement} container 消息列表容器
 * @param {() => Promise<void>} reload 重载消息回调
 * @returns {void}
 */
export function initChannelVirtualList(container, reload) {
	destroyChannelVirtualList()
	hubStore.messages.channelMessagePipeline = createMessagePipeline({
		container,
		loadMoreTop: loadOlderMessages,
		fetchData: fetchVirtualListPage,
		renderItem: renderVirtualListItem,
		initialIndex: (() => {
			const targetId = consumePendingScrollTarget()
			if (!targetId) return Math.max(0, hubStore.messages.channelMessages.length - 1)
			const norm = normalizeEventId(targetId)
			const idx = hubStore.messages.channelMessages.findIndex(
				m => eventIdsEqual(m.eventId, norm),
			)
			return idx >= 0 ? idx : Math.max(0, hubStore.messages.channelMessages.length - 1)
		})(),
		onRenderComplete: createVirtualListRenderComplete(container, reload),
	})
}

/**
 * @param {HTMLElement} container 消息列表容器
 * @param {boolean} [shouldScroll=false] 是否滚动到底部
 * @param {() => Promise<void>} reload 重载消息回调
 * @returns {void}
 */
export function decorateRenderedMessages(container, shouldScroll = false, reload) {
	localizeRenderedMessages(container)
	syncStreamingSlotsFromDom(container)
	applyAvatarsTo(container)
	bindReactions(container, reload)
	bindChannelMessageActions(container)
	if (isTwoPartyCharDialogue()) {
		const gestures = getChatGestures()
		gestures.updateHideCharNames(hubStore.messages.channelMessages)
		gestures.attachLastCharMessageSwipe(container)
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
 * @param {() => Promise<void>} reload 重载消息回调
 * @returns {void}
 */
export function rebuildVirtualListAtEvent(container, eventId, reload) {
	setPendingScrollTarget(eventId)
	destroyChannelVirtualList()
	initChannelVirtualList(container, reload)
	decorateRenderedMessages(container, false, reload)
}

/**
 * @param {string} eventId 目标 eventId
 * @param {() => Promise<void>} reload 重载消息回调
 * @returns {void}
 */
export function queueHighlightAfterRebuild(eventId, reload) {
	setPendingHighlightEventId(eventId)
	rebuildVirtualListAtEvent(getMessagesContainer(), eventId, reload)
}

/** @returns {void} */
export function refreshChannelViewAfterMutation() {
	refreshChannelView()
}
