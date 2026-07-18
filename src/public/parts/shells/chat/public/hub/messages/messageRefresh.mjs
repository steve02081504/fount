import {
	createDocumentFragmentFromHtmlStringNoScriptActivation,
	mountTemplate,
} from '../../../../../scripts/features/template.mjs'
import { applyMessageEditToRow } from '../../shared/messageMerge.mjs'
import { getChannelViewLog } from '../../src/api/groupChannel.mjs'
import { hubEmptyWaveIcon } from '../../src/lib/emojiSvg.mjs'
import { eventIdsEqual } from '../../src/lib/eventId.mjs'
import { handleUIError } from '../../src/ui/errors.mjs'
import { refreshChannelPinsBar } from '../banners.mjs'
import { store } from '../core/state.mjs'
import {
	dismissVolatileStreamPreview,
	getActiveVolatileStreamIds,
} from '../stream/index.mjs'
import {
	firstUnreadEventId,
	markCurrentChannelRead,
} from '../unread.mjs'

import {
	consumePendingScrollTarget,
	fetchRowsForMessageEvent,
	setPendingScrollTarget,
} from './channelMessageStore.mjs'
import {
	scheduleDebouncedChannelRefresh,
} from './channelRefreshScheduler.mjs'
import { loadNonTextChannel } from './channelTypeRouter.mjs'
import { bindReactions, messageRenderOpts, refreshReactionPerms, syncChannelActionsContext } from './messageContext.mjs'
import {
	getMessagesContainer,
	scrollToBottom,
} from './messageScroll.mjs'
import {
	clearHubEmptyPlaceholder,
	mergeIncrementalChannelBatch,
	messageIdSelector,
	reactionsSignature,
	refreshChannelView,
	updateLastMessageId,
} from './messageShared.mjs'
import {
	decorateRenderedMessages,
	destroyChannelVirtualList,
	initChannelVirtualList,
} from './messageVirtualList.mjs'
import { renderMessageReactionsHtml } from './render/reactions.mjs'
import { isChannelMessageGenerating } from './render/text.mjs'

/** @type {Map<string, { messages: object[], reactions: object, reactionsEtag: string, readMarker: object | null, firstUnreadEventId: string | null }>} */
const channelViewCache = new Map()

/**
 * @param {string | null | undefined} groupId 群 ID
 * @param {string | null | undefined} channelId 频道 ID
 * @returns {string | null} 缓存键
 */
function channelCacheKey(groupId, channelId) {
	if (!groupId || !channelId) return null
	return `${groupId}:${channelId}`
}

/** @returns {void} */
function saveChannelViewCache() {
	const key = channelCacheKey(store.context.currentGroupId, store.context.currentChannelId)
	if (!key || !store.messages.channelMessagesSource.length) return
	channelViewCache.set(key, {
		messages: store.messages.channelMessagesSource,
		reactions: store.messages.channelReactions,
		reactionsEtag: store.messages.reactionsEtag,
		readMarker: store.messages.readMarker,
		firstUnreadEventId: store.messages.firstUnreadEventId,
	})
}

/**
 * @param {string | null | undefined} groupId 群 ID
 * @param {string | null | undefined} channelId 频道 ID
 * @returns {boolean} 是否命中缓存
 */
function restoreChannelViewCache(groupId, channelId) {
	const key = channelCacheKey(groupId, channelId)
	const cached = key ? channelViewCache.get(key) : null
	if (!cached?.messages?.length) return false
	store.messages.channelReactions = cached.reactions
	store.messages.reactionsEtag = cached.reactionsEtag
	store.messages.channelMessagesSource = cached.messages
	store.messages.readMarker = cached.readMarker
	store.messages.firstUnreadEventId = cached.firstUnreadEventId
	return true
}

/**
 * @param {HTMLElement} container 消息列表容器
 * @param {Record<string, Record<string, { voters?: string[] }>>} reactions 反应映射
 * @returns {Promise<void>}
 */
async function patchReactionRows(container, reactions) {
	store.messages.channelReactions = reactions
	const options = messageRenderOpts()
	for (const message of store.messages.channelMessages) {
		if (message.type !== 'message' || !message.eventId) continue
		const eventId = String(message.eventId)
		const row = container.querySelector(messageIdSelector(eventId))
		if (!row) continue
		const html = await renderMessageReactionsHtml(
			message,
			reactions,
			options.viewerMemberId,
			{ canAddReactions: options.canAddReactions },
		)
		const existing = row.querySelector('.reactions')
		if (!html) {
			existing?.remove()
			continue
		}
		const frag = await createDocumentFragmentFromHtmlStringNoScriptActivation(html)
		const next = frag.firstElementChild
		if (existing) existing.replaceWith(next)
		else row.appendChild(next)
	}
	bindReactions(container)
}

/**
 * @param {object} message 入站消息行
 * @param {{ scroll?: boolean }} [options] 滚动选项
 * @returns {Promise<void>}
 */
async function applyIncomingMessage(message, { scroll = false } = {}) {
	const container = getMessagesContainer()
	if (!container) return

	const eventId = String(message.eventId || '')
	if (!eventId) return

	if (getActiveVolatileStreamIds().some(streamId => eventIdsEqual(streamId, eventId)) && !isChannelMessageGenerating(message))
		dismissVolatileStreamPreview(eventId, { notifyEnd: false })

	const hadInSource = store.messages.channelMessagesSource.some(m => String(m.eventId) === eventId)
	store.messages.channelMessagesSource = mergeIncrementalChannelBatch(store.messages.channelMessagesSource, [message])
	refreshChannelView()

	clearHubEmptyPlaceholder(container)
	if (!store.messages.channelMessagePipeline) initChannelVirtualList(container)

	const viewIdx = store.messages.channelMessages.findIndex(m => String(m.eventId) === eventId)
	const row = viewIdx >= 0 ? store.messages.channelMessages[viewIdx] : null
	if (row)
		if (hadInSource)
			await store.messages.channelMessagePipeline.replaceItem(viewIdx, row)
		else
			await store.messages.channelMessagePipeline.appendItem(row, scroll)
	else
		await store.messages.channelMessagePipeline.refresh()

	syncChannelActionsContext()
	updateLastMessageId()
	decorateRenderedMessages(container, scroll)
}

/**
 * @param {object[]} batch 入站消息批次
 * @param {{ scroll?: boolean }} [options] 滚动选项
 * @returns {Promise<void>}
 */
async function applyIncomingMessageBatch(batch, { scroll = false } = {}) {
	const container = getMessagesContainer()
	if (!container || !Array.isArray(batch) || !batch.length) {
		if (container && scroll) scrollToBottom()
		return
	}

	const oldIds = new Set(store.messages.channelMessagesSource.map(row => String(row.eventId || '')))
	store.messages.channelMessagesSource = mergeIncrementalChannelBatch(store.messages.channelMessagesSource, batch)
	refreshChannelView()

	clearHubEmptyPlaceholder(container)
	if (!store.messages.channelMessagePipeline) initChannelVirtualList(container)

	const replaceRows = []
	const appendRows = []
	for (const message of batch) {
		const eventId = String(message?.eventId || '')
		if (!eventId) continue
		const viewIndex = store.messages.channelMessages.findIndex(row => String(row.eventId) === eventId)
		if (viewIndex < 0) continue
		const row = store.messages.channelMessages[viewIndex]
		if (oldIds.has(eventId))
			replaceRows.push({ index: viewIndex, row })
		else
			appendRows.push(row)
	}

	for (const { index, row } of replaceRows)
		await store.messages.channelMessagePipeline.replaceItem(index, row)
	if (appendRows.length)
		await store.messages.channelMessagePipeline.appendItemsBatch(appendRows, scroll)
	if (!replaceRows.length && !appendRows.length)
		await store.messages.channelMessagePipeline.refresh()

	syncChannelActionsContext()
	updateLastMessageId()
	decorateRenderedMessages(container, scroll)
}

/**
 * @param {string} eventId 目标 eventId
 * @param {object} row 替换行
 * @returns {Promise<void>}
 */
async function replaceChannelMessageRow(eventId, row) {
	const id = String(eventId).trim()
	const sourceIdx = store.messages.channelMessagesSource.findIndex(
		message => eventIdsEqual(message?.eventId, id),
	)
	if (sourceIdx >= 0)
		store.messages.channelMessagesSource[sourceIdx] = row
	else
		store.messages.channelMessagesSource = mergeIncrementalChannelBatch(store.messages.channelMessagesSource, [row])
	refreshChannelView()

	const container = getMessagesContainer()
	if (!container) return
	clearHubEmptyPlaceholder(container)
	if (!store.messages.channelMessagePipeline) initChannelVirtualList(container)
	const viewIdx = store.messages.channelMessages.findIndex(
		message => eventIdsEqual(message?.eventId, id),
	)
	const viewRow = viewIdx >= 0 ? store.messages.channelMessages[viewIdx] : null
	if (viewRow && store.messages.channelMessagePipeline)
		await store.messages.channelMessagePipeline.replaceItem(viewIdx, viewRow)
	else if (store.messages.channelMessagePipeline)
		await store.messages.channelMessagePipeline.refresh()
	syncChannelActionsContext()
	updateLastMessageId()
	decorateRenderedMessages(container, false)
}

/**
 * @param {HTMLElement} container 消息列表容器
 * @param {boolean} [scrollBottom=false] 是否滚动到底部
 * @returns {Promise<void>}
 */
export async function refreshChannelViewDom(container, scrollBottom = false) {
	refreshChannelView()
	syncChannelActionsContext()
	if (!store.messages.channelMessages.length) {
		destroyChannelVirtualList()
		await mountTemplate(container, 'hub/empty/idle', { iconHtml: hubEmptyWaveIcon })
		store.messages.lastMessageId = null
		return
	}
	if (!store.messages.channelMessagePipeline)
		initChannelVirtualList(container)
	else
		await store.messages.channelMessagePipeline.refresh()
	updateLastMessageId()
	if (scrollBottom) scrollToBottom()
}

/**
 * @returns {Promise<void>}
 */
export async function loadMessages() {
	store.messages.channelSearchQuery = null
	const searchInput = document.getElementById('header-search')
	if (searchInput instanceof HTMLInputElement) searchInput.value = ''
	const container = getMessagesContainer()
	const groupId = store.context.currentGroupId
	const channelId = store.context.currentChannelId
	const channel = store.context.currentState?.channels?.[channelId]
	if (!channelId || !channel) {
		destroyChannelVirtualList()
		await mountTemplate(container, 'hub/nav/side_muted', { i18nKey: 'chat.hub.noChannels' })
		return
	}
	const pipelineKey = `${groupId}:${channelId}`
	const softReload = store.messages.channelMessagePipeline
		&& store.messages.channelPipelineKey === pipelineKey
	if (!softReload) {
		destroyChannelVirtualList()
		const hadStale = restoreChannelViewCache(groupId, channelId)
		if (hadStale) {
			refreshChannelView()
			await refreshReactionPerms()
			initChannelVirtualList(container)
			store.messages.channelPipelineKey = pipelineKey
		}
		else
			await mountTemplate(container, 'hub/empty/loading', {})
	}
	if (await loadNonTextChannel(container, channel)) return
	try {
		store.messages.composerPendingId = null
		store.messages.channelOlderExhausted = false
		const { messages, reactions, readMarker } = await getChannelViewLog(
			groupId,
			channelId,
			{ limit: 50 },
		)
		store.messages.channelReactions = reactions || {}
		store.messages.reactionsEtag = reactionsSignature(reactions)
		store.messages.channelMessagesSource = messages
		store.messages.readMarker = readMarker || null
		store.messages.firstUnreadEventId = firstUnreadEventId(readMarker, messages)
		refreshChannelView()
		await refreshReactionPerms()
		syncChannelActionsContext()
		if (!messages.length) {
			destroyChannelVirtualList()
			store.messages.channelPipelineKey = null
			channelViewCache.delete(channelCacheKey(groupId, channelId) || '')
			await mountTemplate(container, 'hub/empty/idle', { iconHtml: hubEmptyWaveIcon })
			store.messages.lastMessageId = null
			return
		}
		if (!softReload) 
			if (store.messages.firstUnreadEventId)
				setPendingScrollTarget(store.messages.firstUnreadEventId)
			else
				consumePendingScrollTarget()
		
		if (store.messages.channelMessagePipeline)
			await store.messages.channelMessagePipeline.refresh()
		else {
			initChannelVirtualList(container)
			store.messages.channelPipelineKey = pipelineKey
		}
		if (softReload)
			store.messages.channelPipelineKey = pipelineKey
		updateLastMessageId()
		// 有未读时滚到分割线；打开频道即标已读（badge 清零），分割线锚点保留到下次 load
		if (!softReload && !store.messages.firstUnreadEventId) scrollToBottom()
		await markCurrentChannelRead().catch(() => {})
		refreshChannelPinsBar()
		saveChannelViewCache()
		void import('../memberReadMarkers.mjs').then(({ fetchMemberReadMarkers }) => {
			void fetchMemberReadMarkers(groupId, channelId)
		})
	}
	catch (err) {
		const error = handleUIError(err, 'chat.hub.loadMessagesFailed')
		await mountTemplate(container, 'hub/empty/error', {
			i18nKey: 'chat.hub.loadMessagesFailed',
			errorMessage: error.message,
		})
	}
}

/**
 * @returns {Promise<void>}
 */
export async function refreshChannelMessagesIncremental() {
	const searchActive = !!store.messages.channelSearchQuery
	if (!store.context.currentGroupId || !store.context.currentChannelId) return
	const chType = store.context.currentState?.channels?.[store.context.currentChannelId]?.type || 'text'
	if (chType === 'list' || chType === 'streaming') return

	const container = getMessagesContainer()
	if (!container) return

	const options = { limit: 50 }
	if (store.messages.lastMessageId)
		options.since = store.messages.lastMessageId

	const { messages, reactions } = await getChannelViewLog(
		store.context.currentGroupId,
		store.context.currentChannelId,
		options,
	)
	const reactionSig = reactionsSignature(reactions)
	if (!messages.length && !reactionSig) return

	if (searchActive) {
		if (reactionSig !== store.messages.reactionsEtag) {
			store.messages.reactionsEtag = reactionSig
			store.messages.channelReactions = reactions || {}
		}
		if (messages.length) {
			store.messages.channelMessagesSource = mergeIncrementalChannelBatch(
				store.messages.channelMessagesSource,
				messages,
			)
			updateLastMessageId()
		}
		return
	}

	clearHubEmptyPlaceholder(container)

	const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
	if (reactionSig !== store.messages.reactionsEtag) {
		store.messages.reactionsEtag = reactionSig
		await patchReactionRows(container, reactions || {})
		if (!messages.length) return
	}
	store.messages.channelReactions = reactions || {}
	await applyIncomingMessageBatch(messages, { scroll: nearBottom })
}

/**
 * @param {{ immediate?: boolean }} [options] 调度选项
 * @returns {void}
 */
export function scheduleChannelIncrementalRefresh({ immediate = false } = {}) {
	scheduleDebouncedChannelRefresh(
		() => refreshChannelMessagesIncremental(),
		200,
		{ immediate },
	)
}

/**
 * @param {string} targetId 目标消息 eventId
 * @param {{ newContent?: object, fileCount?: number } | null} [editContent] WS 带来的 message_edit.content
 * @returns {Promise<void>}
 */
export async function applyChannelMessageEdit(targetId, editContent = null) {
	const id = String(targetId || '').trim()
	if (!id || !store.context.currentGroupId || !store.context.currentChannelId) return
	dismissVolatileStreamPreview(id, { notifyEnd: false })

	if (editContent?.newContent) {
		const sourceIdx = store.messages.channelMessagesSource.findIndex(
			message => eventIdsEqual(message?.eventId, id),
		)
		if (sourceIdx >= 0) {
			const patched = applyMessageEditToRow(store.messages.channelMessagesSource[sourceIdx], editContent)
			await replaceChannelMessageRow(id, patched)
			return
		}
	}

	const rows = await fetchRowsForMessageEvent(store.context.currentGroupId, store.context.currentChannelId, id)
	const row = rows.find(m => eventIdsEqual(m.eventId, id))
	if (!row) {
		scheduleChannelIncrementalRefresh({ immediate: true })
		return
	}
	await replaceChannelMessageRow(id, row)
}

/**
 * @param {string} targetId 目标消息 eventId
 * @returns {Promise<void>}
 */
export async function applyChannelMessageDelete(targetId) {
	const id = String(targetId || '').trim()
	if (!id) return
	dismissVolatileStreamPreview(id, { notifyEnd: false })
	const idx = store.messages.channelMessages.findIndex(m => String(m.eventId) === id)
	if (idx < 0) return
	store.messages.channelMessagesSource = store.messages.channelMessagesSource.filter(m => String(m.eventId) !== id)
	const container = getMessagesContainer()
	refreshChannelView()
	if (store.messages.channelMessagePipeline)
		await store.messages.channelMessagePipeline.deleteItem(idx)
	syncChannelActionsContext()
	updateLastMessageId()
	if (container) decorateRenderedMessages(container, false)
}
