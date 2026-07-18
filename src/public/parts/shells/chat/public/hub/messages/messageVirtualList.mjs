import {
	getChannelViewLog,
} from '../../src/api/groupChannel.mjs'
import { eventIdsEqual, normalizeEventId } from '../../src/lib/eventId.mjs'
import { store } from '../core/state.mjs'
import { attachLastCharMessageSwipe, updateHideCharNames } from '../gestures/chatGestures.mjs'
import { syncStreamingSlotsFromDom } from '../stream/index.mjs'

import {
	consumePendingScrollTarget,
	setPendingScrollTarget,
} from './channelMessageStore.mjs'
import { messageRenderOpts, reloadChannel } from './messageContext.mjs'
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
	bindMessageSurface,
	createMessageSurfacePipeline,
} from './messageSurface.mjs'

/** @returns {void} */
export function destroyChannelVirtualList() {
	store.messages.channelMessagePipeline?.destroy()
	store.messages.channelMessagePipeline = null
	store.messages.channelPipelineKey = null
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
	if (store.messages.channelOlderExhausted || !store.context.currentGroupId || !store.context.currentChannelId) return 0
	const oldest = store.messages.channelMessages[0]
	const oldestId = oldest?.eventId
	if (!oldestId || String(oldestId).startsWith('pending:')) {
		store.messages.channelOlderExhausted = true
		return 0
	}
	const limit = Math.max(1, Math.ceil(store.messages.channelMessages.length / 2))
	const known = new Set(
		store.messages.channelMessagesSource.map(m => String(m.eventId)).filter(Boolean),
	)
	let before = oldestId
	let hasMore = true
	let fresh = []
	while (hasMore && !fresh.length) {
		let batch = []
		let oldestRawEventId = null
		try {
			const page = await getChannelViewLog(store.context.currentGroupId, store.context.currentChannelId, {
				before,
				limit,
			})
			batch = page.messages || []
			hasMore = page.hasMore
			oldestRawEventId = page.oldestRawEventId
		}
		catch {
			store.messages.channelOlderExhausted = true
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
		store.messages.channelOlderExhausted = true
		return 0
	}
	if (!fresh.length)
		return 0
	store.messages.channelMessagesSource = [...fresh, ...store.messages.channelMessagesSource]
	refreshChannelView()
	const { syncChannelActionsContext } = await import('./messageContext.mjs')
	syncChannelActionsContext()
	return fresh.length
}

/**
 * @param {HTMLElement} container 消息列表容器
 * @returns {void}
 */
export function initChannelVirtualList(container) {
	destroyChannelVirtualList()
	store.messages.channelMessagePipeline = createMessageSurfacePipeline({
		container,
		loadMoreTop: loadOlderMessages,
		/** @returns {object[]} 当前频道消息 */
		getMessages: () => store.messages.channelMessages,
		getRenderOpts: messageRenderOpts,
		/** @returns {void} */
		onDecorate: () => {
			decorateRenderedMessages(container, false)
		},
		initialIndex: (() => {
			const targetId = consumePendingScrollTarget()
			if (!targetId) return Math.max(0, store.messages.channelMessages.length - 1)
			const norm = normalizeEventId(targetId)
			const idx = store.messages.channelMessages.findIndex(
				m => eventIdsEqual(m.eventId, norm),
			)
			return idx >= 0 ? idx : Math.max(0, store.messages.channelMessages.length - 1)
		})(),
	})
}

/**
 * @param {HTMLElement} container 消息列表容器
 * @param {boolean} [shouldScroll=false] 是否滚动到底部
 * @returns {void}
 */
export function decorateRenderedMessages(container, shouldScroll = false) {
	bindMessageSurface(container, {
		groupId: store.context.currentGroupId,
		channelId: store.context.currentChannelId,
		messages: store.messages.channelMessages,
		reactions: store.messages.channelReactions,
		reload: reloadChannel,
	})
	syncStreamingSlotsFromDom(container)
	if (isTwoPartyCharDialogue()) {
		updateHideCharNames(store.messages.channelMessages)
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
