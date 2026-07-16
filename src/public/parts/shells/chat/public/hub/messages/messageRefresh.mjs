import {
	createDocumentFragmentFromHtmlStringNoScriptActivation,
	mountTemplate,
} from '../../../../../scripts/features/template.mjs'
import { getChannelViewLog } from '../../src/api/groupChannel.mjs'
import { hubEmptyWaveIcon } from '../../src/lib/emojiSvg.mjs'
import { eventIdsEqual } from '../../src/lib/eventId.mjs'
import { handleUIError } from '../../src/ui/errors.mjs'
import { refreshChannelPinsBar } from '../banners.mjs'
import { hubStore } from '../core/state.mjs'
import {
	dismissVolatileStreamPreview,
	getActiveVolatileStreamIds,
} from '../stream/index.mjs'
import { isThreadDrawerOpen } from '../threadDrawer.mjs'
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
import { bindReactions, messageRenderOpts, refreshReactionPerms } from './messageContext.mjs'
import {
	getMessagesContainer,
	scrollToBottom,
} from './messageScroll.mjs'
import {
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
	const key = channelCacheKey(hubStore.context.currentGroupId, hubStore.context.currentChannelId)
	if (!key || !hubStore.messages.channelMessagesSource.length) return
	channelViewCache.set(key, {
		messages: hubStore.messages.channelMessagesSource,
		reactions: hubStore.messages.channelReactions,
		reactionsEtag: hubStore.messages.reactionsEtag,
		readMarker: hubStore.messages.readMarker,
		firstUnreadEventId: hubStore.messages.firstUnreadEventId,
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
	hubStore.messages.channelReactions = cached.reactions
	hubStore.messages.reactionsEtag = cached.reactionsEtag
	hubStore.messages.channelMessagesSource = cached.messages
	hubStore.messages.readMarker = cached.readMarker
	hubStore.messages.firstUnreadEventId = cached.firstUnreadEventId
	return true
}

/**
 * @param {HTMLElement} container 消息列表容器
 * @param {Record<string, Record<string, { voters?: string[] }>>} reactions 反应映射
 * @param {() => Promise<void>} reload 重载消息回调
 * @returns {Promise<void>}
 */
async function patchReactionRows(container, reactions, reload) {
	hubStore.messages.channelReactions = reactions
	const options = messageRenderOpts()
	for (const message of hubStore.messages.channelMessages) {
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
		const existing = row.querySelector('.hub-reactions')
		if (!html) {
			existing?.remove()
			continue
		}
		const frag = await createDocumentFragmentFromHtmlStringNoScriptActivation(html)
		const next = frag.firstElementChild
		if (existing) existing.replaceWith(next)
		else row.appendChild(next)
	}
	bindReactions(container, reload)
}

/**
 * @param {object} message 入站消息行
 * @param {{ scroll?: boolean }} [options] 滚动选项
 * @param {() => Promise<void>} reload 重载消息回调
 * @param {() => void} syncCtx 同步操作上下文
 * @returns {Promise<void>}
 */
async function applyIncomingMessage(message, { scroll = false } = {}, reload, syncCtx) {
	const container = getMessagesContainer()
	if (!container) return

	const eventId = String(message.eventId || '')
	if (!eventId) return

	if (getActiveVolatileStreamIds().some(streamId => eventIdsEqual(streamId, eventId)) && !isChannelMessageGenerating(message))
		dismissVolatileStreamPreview(eventId, { notifyEnd: false })

	const hadInSource = hubStore.messages.channelMessagesSource.some(m => String(m.eventId) === eventId)
	hubStore.messages.channelMessagesSource = mergeIncrementalChannelBatch(hubStore.messages.channelMessagesSource, [message])
	refreshChannelView()

	if (container.querySelector('.hub-empty')) container.innerHTML = ''
	if (!hubStore.messages.channelMessagePipeline) initChannelVirtualList(container, reload)

	const viewIdx = hubStore.messages.channelMessages.findIndex(m => String(m.eventId) === eventId)
	const row = viewIdx >= 0 ? hubStore.messages.channelMessages[viewIdx] : null
	if (row)
		if (hadInSource)
			await hubStore.messages.channelMessagePipeline.replaceItem(viewIdx, row)
		else
			await hubStore.messages.channelMessagePipeline.appendItem(row, scroll)
	else
		await hubStore.messages.channelMessagePipeline.refresh()

	if (!isThreadDrawerOpen()) syncCtx()
	updateLastMessageId()
	decorateRenderedMessages(container, scroll, reload)
}

/**
 * @param {object[]} batch 入站消息批次
 * @param {{ scroll?: boolean }} [options] 滚动选项
 * @param {() => Promise<void>} reload 重载消息回调
 * @param {() => void} syncCtx 同步操作上下文
 * @returns {Promise<void>}
 */
async function applyIncomingMessageBatch(batch, { scroll = false } = {}, reload, syncCtx) {
	const container = getMessagesContainer()
	if (!container || !Array.isArray(batch) || !batch.length) {
		if (container && scroll) scrollToBottom()
		return
	}

	const oldIds = new Set(hubStore.messages.channelMessagesSource.map(row => String(row.eventId || '')))
	hubStore.messages.channelMessagesSource = mergeIncrementalChannelBatch(hubStore.messages.channelMessagesSource, batch)
	refreshChannelView()

	if (container.querySelector('.hub-empty')) container.innerHTML = ''
	if (!hubStore.messages.channelMessagePipeline) initChannelVirtualList(container, reload)

	const replaceRows = []
	const appendRows = []
	for (const message of batch) {
		const eventId = String(message?.eventId || '')
		if (!eventId) continue
		const viewIndex = hubStore.messages.channelMessages.findIndex(row => String(row.eventId) === eventId)
		if (viewIndex < 0) continue
		const row = hubStore.messages.channelMessages[viewIndex]
		if (oldIds.has(eventId))
			replaceRows.push({ index: viewIndex, row })
		else
			appendRows.push(row)
	}

	for (const { index, row } of replaceRows)
		await hubStore.messages.channelMessagePipeline.replaceItem(index, row)
	if (appendRows.length)
		await hubStore.messages.channelMessagePipeline.appendItemsBatch(appendRows, scroll)
	if (!replaceRows.length && !appendRows.length)
		await hubStore.messages.channelMessagePipeline.refresh()

	if (!isThreadDrawerOpen()) syncCtx()
	updateLastMessageId()
	decorateRenderedMessages(container, scroll, reload)
}

/**
 * @param {string} eventId 目标 eventId
 * @param {object} row 替换行
 * @param {() => Promise<void>} reload 重载消息回调
 * @param {() => void} syncCtx 同步操作上下文
 * @returns {Promise<void>}
 */
async function replaceChannelMessageRow(eventId, row, reload, syncCtx) {
	const id = String(eventId).trim()
	const sourceIdx = hubStore.messages.channelMessagesSource.findIndex(
		message => eventIdsEqual(message?.eventId, id),
	)
	if (sourceIdx >= 0)
		hubStore.messages.channelMessagesSource[sourceIdx] = row
	else
		hubStore.messages.channelMessagesSource = mergeIncrementalChannelBatch(hubStore.messages.channelMessagesSource, [row])
	refreshChannelView()

	const container = getMessagesContainer()
	if (!container) return
	if (container.querySelector('.hub-empty')) container.innerHTML = ''
	if (!hubStore.messages.channelMessagePipeline) initChannelVirtualList(container, reload)
	const viewIdx = hubStore.messages.channelMessages.findIndex(
		message => eventIdsEqual(message?.eventId, id),
	)
	const viewRow = viewIdx >= 0 ? hubStore.messages.channelMessages[viewIdx] : null
	if (viewRow && hubStore.messages.channelMessagePipeline)
		await hubStore.messages.channelMessagePipeline.replaceItem(viewIdx, viewRow)
	else if (hubStore.messages.channelMessagePipeline)
		await hubStore.messages.channelMessagePipeline.refresh()
	syncCtx()
	updateLastMessageId()
	decorateRenderedMessages(container, false, reload)
}

/**
 * @param {HTMLElement} container 消息列表容器
 * @param {boolean} [scrollBottom=false] 是否滚动到底部
 * @param {() => Promise<void>} reload 重载消息回调
 * @param {() => void} syncCtx 同步操作上下文
 * @returns {Promise<void>}
 */
export async function refreshChannelViewDom(container, scrollBottom = false, reload, syncCtx) {
	refreshChannelView()
	syncCtx()
	if (!hubStore.messages.channelMessages.length) {
		destroyChannelVirtualList()
		await mountTemplate(container, 'hub/empty/idle', { iconHtml: hubEmptyWaveIcon })
		hubStore.messages.lastMessageId = null
		return
	}
	if (!hubStore.messages.channelMessagePipeline)
		initChannelVirtualList(container, reload)
	else
		await hubStore.messages.channelMessagePipeline.refresh()
	updateLastMessageId()
	if (scrollBottom) scrollToBottom()
}

/**
 * @param {() => Promise<void>} reload 重载消息回调
 * @param {() => void} syncCtx 同步操作上下文
 * @returns {Promise<void>}
 */
export async function loadMessages(reload, syncCtx) {
	hubStore.messages.channelSearchQuery = null
	const searchInput = document.getElementById('hub-header-search')
	if (searchInput instanceof HTMLInputElement) searchInput.value = ''
	const container = getMessagesContainer()
	const groupId = hubStore.context.currentGroupId
	const channelId = hubStore.context.currentChannelId
	const channel = hubStore.context.currentState?.channels?.[channelId]
	if (!channelId || !channel) {
		destroyChannelVirtualList()
		await mountTemplate(container, 'hub/nav/side_muted', { i18nKey: 'chat.hub.noChannels' })
		return
	}
	destroyChannelVirtualList()
	const hadStale = restoreChannelViewCache(groupId, channelId)
	if (hadStale) {
		refreshChannelView()
		await refreshReactionPerms()
		initChannelVirtualList(container, reload)
	}
	else
		await mountTemplate(container, 'hub/empty/loading', {})
	if (await loadNonTextChannel(container, channel)) return
	try {
		hubStore.messages.composerPendingId = null
		hubStore.messages.channelOlderExhausted = false
		const { messages, reactions, readMarker } = await getChannelViewLog(
			groupId,
			channelId,
			{ limit: 50 },
		)
		hubStore.messages.channelReactions = reactions || {}
		hubStore.messages.reactionsEtag = reactionsSignature(reactions)
		hubStore.messages.channelMessagesSource = messages
		hubStore.messages.readMarker = readMarker || null
		hubStore.messages.firstUnreadEventId = firstUnreadEventId(readMarker, messages)
		refreshChannelView()
		await refreshReactionPerms()
		syncCtx()
		if (!messages.length) {
			destroyChannelVirtualList()
			channelViewCache.delete(channelCacheKey(groupId, channelId) || '')
			await mountTemplate(container, 'hub/empty/idle', { iconHtml: hubEmptyWaveIcon })
			hubStore.messages.lastMessageId = null
			return
		}
		if (hubStore.messages.firstUnreadEventId)
			setPendingScrollTarget(hubStore.messages.firstUnreadEventId)
		else
			consumePendingScrollTarget()
		if (hubStore.messages.channelMessagePipeline)
			await hubStore.messages.channelMessagePipeline.refresh()
		else
			initChannelVirtualList(container, reload)
		updateLastMessageId()
		// 有未读时滚到分割线；打开频道即标已读（badge 清零），分割线锚点保留到下次 load
		if (!hubStore.messages.firstUnreadEventId) scrollToBottom()
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
 * @param {() => Promise<void>} reload 重载消息回调
 * @param {() => void} syncCtx 同步操作上下文
 * @returns {Promise<void>}
 */
export async function refreshChannelMessagesIncremental(reload, syncCtx) {
	const searchActive = !!hubStore.messages.channelSearchQuery
	if (!hubStore.context.currentGroupId || !hubStore.context.currentChannelId) return
	const chType = hubStore.context.currentState?.channels?.[hubStore.context.currentChannelId]?.type || 'text'
	if (chType === 'list' || chType === 'streaming') return

	const container = getMessagesContainer()
	if (!container) return

	const options = { limit: 50 }
	if (hubStore.messages.lastMessageId)
		options.since = hubStore.messages.lastMessageId

	const { messages, reactions } = await getChannelViewLog(
		hubStore.context.currentGroupId,
		hubStore.context.currentChannelId,
		options,
	)
	const reactionSig = reactionsSignature(reactions)
	if (!messages.length && !reactionSig) return

	if (searchActive) {
		if (reactionSig !== hubStore.messages.reactionsEtag) {
			hubStore.messages.reactionsEtag = reactionSig
			hubStore.messages.channelReactions = reactions || {}
		}
		if (messages.length) {
			hubStore.messages.channelMessagesSource = mergeIncrementalChannelBatch(
				hubStore.messages.channelMessagesSource,
				messages,
			)
			updateLastMessageId()
		}
		return
	}

	if (container.querySelector('.hub-empty')) container.innerHTML = ''

	const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
	if (reactionSig !== hubStore.messages.reactionsEtag) {
		hubStore.messages.reactionsEtag = reactionSig
		await patchReactionRows(container, reactions || {}, reload)
		if (!messages.length) return
	}
	hubStore.messages.channelReactions = reactions || {}
	await applyIncomingMessageBatch(messages, { scroll: nearBottom }, reload, syncCtx)
}

/**
 * @param {{ immediate?: boolean }} [options] 调度选项
 * @param {() => Promise<void>} reload 重载消息回调
 * @param {() => void} syncCtx 同步操作上下文
 * @returns {void}
 */
export function scheduleChannelIncrementalRefresh({ immediate = false } = {}, reload, syncCtx) {
	scheduleDebouncedChannelRefresh(
		() => refreshChannelMessagesIncremental(reload, syncCtx),
		200,
		{ immediate },
	)
}

/**
 * @param {string} targetId 目标消息 eventId
 * @param {() => Promise<void>} reload 重载消息回调
 * @param {() => void} syncCtx 同步操作上下文
 * @returns {Promise<void>}
 */
export async function applyChannelMessageEdit(targetId, reload, syncCtx) {
	const id = String(targetId || '').trim()
	if (!id || !hubStore.context.currentGroupId || !hubStore.context.currentChannelId) return
	dismissVolatileStreamPreview(id, { notifyEnd: false })

	const rows = await fetchRowsForMessageEvent(hubStore.context.currentGroupId, hubStore.context.currentChannelId, id)
	const row = rows.find(m => eventIdsEqual(m.eventId, id))
	if (!row) {
		scheduleChannelIncrementalRefresh({ immediate: true }, reload, syncCtx)
		return
	}
	await replaceChannelMessageRow(id, row, reload, syncCtx)
}

/**
 * @param {string} targetId 目标消息 eventId
 * @param {() => Promise<void>} reload 重载消息回调
 * @param {() => void} syncCtx 同步操作上下文
 * @returns {Promise<void>}
 */
export async function applyChannelMessageDelete(targetId, reload, syncCtx) {
	const id = String(targetId || '').trim()
	if (!id) return
	dismissVolatileStreamPreview(id, { notifyEnd: false })
	const idx = hubStore.messages.channelMessages.findIndex(m => String(m.eventId) === id)
	if (idx < 0) return
	hubStore.messages.channelMessagesSource = hubStore.messages.channelMessagesSource.filter(m => String(m.eventId) !== id)
	const container = getMessagesContainer()
	refreshChannelView()
	if (hubStore.messages.channelMessagePipeline)
		await hubStore.messages.channelMessagePipeline.deleteItem(idx)
	syncCtx()
	updateLastMessageId()
	if (container) decorateRenderedMessages(container, false, reload)
}
