import {
	getChannelViewLog,
} from '../../src/endpoints/groupChannel.mjs'
import { eventIdsEqual, normalizeEventId } from '../../src/lib/eventId.mjs'
import { store } from '../core/state.mjs'
import { attachLastCharMessageSwipe, updateHideCharNames } from '../gestures/chatGestures.mjs'
import { syncStreamingSlotsFromDom } from '../stream/index.mjs'

import {
	consumePendingScrollTarget,
	setPendingScrollTarget,
} from './channelMessageStore.mjs'
import {
	captureChannelViewScope,
	isChannelViewScopeCurrent,
} from './channelViewScope.mjs'
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
import { revokeGroupFileBlobUrlsForChannel } from './render/file.mjs'

/**
 * 销毁当前聊天频道的虚拟列表与相关 Blob URL。
 * @returns {void}
 */
export function destroyChannelVirtualList() {
	const channelKey = store.messages.channelPipelineKey
	store.messages.channelMessagePipeline?.destroy()
	store.messages.channelMessagePipeline = null
	store.messages.channelPipelineKey = null
	revokeGroupFileBlobUrlsForChannel(channelKey)
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
	const scope = captureChannelViewScope(store.context.currentGroupId, store.context.currentChannelId)
	if (store.messages.channelOlderExhausted || !scope.groupId || !scope.channelId) return 0
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
			const page = await getChannelViewLog(scope.groupId, scope.channelId, {
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
		if (!isChannelViewScopeCurrent(scope)) return 0
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
	if (!isChannelViewScopeCurrent(scope)) return 0
	store.messages.channelMessagesSource = [...fresh, ...store.messages.channelMessagesSource]
	refreshChannelView()
	const { syncChannelActionsContext } = await import('./messageContext.mjs')
	if (!isChannelViewScopeCurrent(scope)) return 0
	syncChannelActionsContext()
	return fresh.length
}

/**
 * @param {HTMLElement} container 消息列表容器
 * @returns {void}
 */
export function initChannelVirtualList(container) {
	destroyChannelVirtualList()
	const groupId = store.context.currentGroupId
	const channelId = store.context.currentChannelId
	if (groupId && channelId)
		store.messages.channelPipelineKey = `${groupId}:${channelId}`
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
 * 修复消息分组头像标记：`last-in-group` 依赖「下一条消息」，增量追加时
 * 上一条已渲染的消息不会自动重画，会残留错误的末条头像。这里按 DOM 相邻关系
 * 回填：某行是末条，当且仅当它没有同作者的下一条（下一条是 `first-in-group`
 * 即新分组，`first-in-group` 只依赖已知的上一条，故恒正确）。
 * @param {HTMLElement} container 消息列表容器
 * @returns {void}
 */
export function fixMessageGrouping(container) {
	for (const row of container.querySelectorAll('.message-row[data-author-key]')) {
		const nextRow = row.nextElementSibling
		row.classList.toggle('last-in-group', !(nextRow?.matches('.message-row[data-author-key]')
			&& nextRow.dataset.authorKey === row.dataset.authorKey
			&& !nextRow.classList.contains('first-in-group')))
	}
}

/**
 * @param {HTMLElement} container 消息列表容器
 * @param {boolean} [shouldScroll=false] 是否滚动到底部
 * @returns {void}
 */
export function decorateRenderedMessages(container, shouldScroll = false) {
	fixMessageGrouping(container)
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
