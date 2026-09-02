import { createDocumentFragmentFromHtmlStringNoScriptActivation } from '../../../../../scripts/features/template.mjs'
import { applyMessageEditToRow } from '../../shared/messageMerge.mjs'
import { getChannelViewLog } from '../../src/endpoints/groupChannel.mjs'
import { hubEmptyWaveIcon } from '../../src/lib/emojiSvg.mjs'
import { eventIdsEqual } from '../../src/lib/eventId.mjs'
import { mountTemplate } from '../../src/templates.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { refreshChannelPinsBar } from '../banners.mjs'
import { store } from '../core/state.mjs'
import {
	dismissVolatileStreamPreview,
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
import { enqueueChannelMutation } from './channelMutationQueue.mjs'
import {
	scheduleDebouncedChannelRefresh,
} from './channelRefreshScheduler.mjs'
import { loadNonTextChannel } from './channelTypeRouter.mjs'
import {
	captureChannelViewScope,
	isChannelViewScopeCurrent,
} from './channelViewScope.mjs'
import { classifyIncomingBatch } from './incomingBatch.mjs'
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
	const scope = captureChannelViewScope(store.context.currentGroupId, store.context.currentChannelId)
	store.messages.channelReactions = reactions
	const options = messageRenderOpts()
	for (const message of store.messages.channelMessages) {
		if (message.type !== 'message' || !message.eventId) continue
		if (!isChannelViewScopeCurrent(scope)) return
		const eventId = String(message.eventId)
		const row = container.querySelector(messageIdSelector(eventId))
		if (!row) continue
		const html = await renderMessageReactionsHtml(
			message,
			reactions,
			options.viewerMemberId,
			{ canAddReactions: options.canAddReactions },
		)
		if (!isChannelViewScopeCurrent(scope)) return
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
 * @param {object[]} batch 入站消息批次
 * @param {{ scroll?: boolean }} [options] 滚动选项
 * @returns {Promise<void>}
 */
async function applyIncomingMessageBatch(batch, { scroll = false } = {}) {
	const scope = captureChannelViewScope(store.context.currentGroupId, store.context.currentChannelId)
	const container = getMessagesContainer()
	if (!container || !Array.isArray(batch) || !batch.length) {
		if (container && scroll && isChannelViewScopeCurrent(scope)) scrollToBottom()
		return
	}

	const pendingId = store.messages.composerPendingId
	const oldSource = store.messages.channelMessagesSource
	if (!isChannelViewScopeCurrent(scope)) return
	store.messages.channelMessagesSource = mergeIncrementalChannelBatch(oldSource, batch)
	const pendingReplaced = !!pendingId
		&& !store.messages.channelMessagesSource.some(m => String(m.eventId) === pendingId)
	refreshChannelView()

	clearHubEmptyPlaceholder(container)
	// 首次创建管道时 channelMessages 已含本批，初始 refresh 即完整渲染；
	// 继续逐条 append/replace 会把同一批行再渲染一遍造成重复。
	if (!store.messages.channelMessagePipeline) {
		if (!isChannelViewScopeCurrent(scope)) return
		initChannelVirtualList(container)
		await store.messages.channelMessagePipeline.refresh()
		syncChannelActionsContext()
		updateLastMessageId()
		decorateRenderedMessages(container, scroll)
		return
	}

	if (pendingReplaced) {
		if (!isChannelViewScopeCurrent(scope)) return
		await store.messages.channelMessagePipeline.refresh()
		syncChannelActionsContext()
		updateLastMessageId()
		decorateRenderedMessages(container, scroll)
		return
	}

	const { replaceRows, appendRows } = classifyIncomingBatch(batch, oldSource, store.messages.channelMessages)

	for (const { index, row } of replaceRows) {
		if (!isChannelViewScopeCurrent(scope)) return
		await store.messages.channelMessagePipeline.replaceItem(index, row)
	}
	if (appendRows.length && isChannelViewScopeCurrent(scope))
		await store.messages.channelMessagePipeline.appendItemsBatch(appendRows, scroll)
	if (!replaceRows.length && !appendRows.length && isChannelViewScopeCurrent(scope))
		await store.messages.channelMessagePipeline.refresh()

	if (!isChannelViewScopeCurrent(scope)) return
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
	const scope = captureChannelViewScope(store.context.currentGroupId, store.context.currentChannelId)
	const id = eventId.trim()
	const sourceIdx = store.messages.channelMessagesSource.findIndex(
		message => eventIdsEqual(message?.eventId, id),
	)
	if (!isChannelViewScopeCurrent(scope)) return
	if (sourceIdx >= 0)
		store.messages.channelMessagesSource[sourceIdx] = row
	else
		store.messages.channelMessagesSource = mergeIncrementalChannelBatch(store.messages.channelMessagesSource, [row])
	refreshChannelView()

	const container = getMessagesContainer()
	if (!container) return
	clearHubEmptyPlaceholder(container)
	// 同 applyIncomingMessageBatch：首次创建时初始 refresh 已渲染当前 view，直接收尾
	if (!store.messages.channelMessagePipeline) {
		if (!isChannelViewScopeCurrent(scope)) return
		initChannelVirtualList(container)
		await store.messages.channelMessagePipeline.refresh()
		syncChannelActionsContext()
		updateLastMessageId()
		decorateRenderedMessages(container, false)
		return
	}
	const viewIdx = store.messages.channelMessages.findIndex(
		message => eventIdsEqual(message?.eventId, id),
	)
	const viewRow = viewIdx >= 0 ? store.messages.channelMessages[viewIdx] : null
	if (!isChannelViewScopeCurrent(scope)) return
	if (viewRow && store.messages.channelMessagePipeline)
		await store.messages.channelMessagePipeline.replaceItem(viewIdx, viewRow)
	else if (store.messages.channelMessagePipeline)
		await store.messages.channelMessagePipeline.refresh()
	if (!isChannelViewScopeCurrent(scope)) return
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
 * @param {(() => boolean) | undefined} [isCurrent] 本次频道选择的有效性守卫；为假则立即停止后续副作用
 * @returns {Promise<void>}
 */
export async function loadMessages(isCurrent) {
	store.messages.channelSearchQuery = null
	const searchInput = document.getElementById('header-search')
	if (searchInput instanceof HTMLInputElement) searchInput.value = ''
	const container = getMessagesContainer()
	const groupId = store.context.currentGroupId
	const channelId = store.context.currentChannelId
	const channel = store.context.currentState?.channels?.[channelId]
	if (!channelId || !channel) {
		destroyChannelVirtualList()
		await mountTemplate(container, 'hub/nav/side_muted', { i18nKey: 'chat.hub.no.channels' })
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
		}
		else
			await mountTemplate(container, 'hub/empty/loading', {})
	}
	if (await loadNonTextChannel(container, channel)) return
	if (isCurrent && !isCurrent()) return
	try {
		store.messages.composerPendingId = null
		store.messages.channelOlderExhausted = false
		const { messages, reactions, readMarker } = await getChannelViewLog(
			groupId,
			channelId,
			{ limit: 50 },
		)
		if (isCurrent && !isCurrent()) return
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
		else
			initChannelVirtualList(container)
		updateLastMessageId()
		// 有未读时滚到分割线；打开频道即标已读（badge 清零），分割线锚点保留到下次 load
		if (!softReload && !store.messages.firstUnreadEventId) scrollToBottom()
		await markCurrentChannelRead().catch(handleError('chat.hub.operationFailed'))
		if (isCurrent && !isCurrent()) return
		refreshChannelPinsBar().catch(handleError('chat.hub.operationFailed'))
		saveChannelViewCache()
		try {
			const { fetchMemberReadMarkers } = await import('../memberReadMarkers.mjs')
			await fetchMemberReadMarkers(groupId, channelId)
			if (isCurrent && !isCurrent()) return
		}
		catch (error) {
			handleError('chat.hub.operationFailed')(error)
		}
	}
	catch (err) {
		const error = handleError('chat.hub.load.messagesFailed')(err)
		await mountTemplate(container, 'hub/empty/error', {
			i18nKey: 'chat.hub.load.messagesFailed',
			errorMessage: error.message,
		})
	}
}

/**
 * @returns {Promise<void>}
 */
export function refreshChannelMessagesIncremental() {
	return enqueueChannelMutation(doRefreshChannelMessagesIncremental)
}

/**
 * @returns {Promise<void>}
 */
async function doRefreshChannelMessagesIncremental() {
	const searchActive = !!store.messages.channelSearchQuery
	const groupId = store.context.currentGroupId
	const channelId = store.context.currentChannelId
	const scope = captureChannelViewScope(groupId, channelId)
	if (!groupId || !channelId) return
	const chType = store.context.currentState?.channels?.[channelId]?.type || 'text'
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
	if (!isChannelViewScopeCurrent(scope)) return
	const reactionSig = reactionsSignature(reactions)
	if (!messages.length && !reactionSig) return

	if (searchActive) {
		if (reactionSig !== store.messages.reactionsEtag) {
			store.messages.reactionsEtag = reactionSig
			store.messages.channelReactions = reactions || {}
		}
		if (messages.length && isChannelViewScopeCurrent(scope)) {
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
		if (!isChannelViewScopeCurrent(scope)) return
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
 * @param {object} [sortMeta] 编辑行自身排序元数据（timestamp/hlc，供生成终稿更新排序键）
 * @returns {Promise<void>}
 */
export function applyChannelMessageEdit(targetId, editContent = null, sortMeta = null) {
	return enqueueChannelMutation(() => doApplyChannelMessageEdit(targetId, editContent, sortMeta))
}

/**
 * @param {string} targetId 目标消息 eventId
 * @param {{ newContent?: object, fileCount?: number } | null} [editContent] WS 带来的 message_edit.content
 * @param {object} [sortMeta] 编辑行自身排序元数据（timestamp/hlc）
 * @returns {Promise<void>}
 */
async function doApplyChannelMessageEdit(targetId, editContent = null, sortMeta = null) {
	const id = targetId.trim()
	const scope = captureChannelViewScope(store.context.currentGroupId, store.context.currentChannelId)
	if (!id || !scope.groupId || !scope.channelId) return
	dismissVolatileStreamPreview(id, { notifyEnd: false })

	if (editContent?.newContent) {
		const sourceIdx = store.messages.channelMessagesSource.findIndex(
			message => eventIdsEqual(message?.eventId, id),
		)
		if (sourceIdx >= 0) {
			if (!isChannelViewScopeCurrent(scope)) return
			await replaceChannelMessageRow(id, applyMessageEditToRow(store.messages.channelMessagesSource[sourceIdx], editContent, sortMeta))
			return
		}
	}

	const rows = await fetchRowsForMessageEvent(scope.groupId, scope.channelId, id)
	if (!isChannelViewScopeCurrent(scope)) return
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
export function applyChannelMessageDelete(targetId) {
	return enqueueChannelMutation(() => doApplyChannelMessageDelete(targetId))
}

/**
 * @param {string} targetId 目标消息 eventId
 * @returns {Promise<void>}
 */
async function doApplyChannelMessageDelete(targetId) {
	const id = targetId.trim()
	const scope = captureChannelViewScope(store.context.currentGroupId, store.context.currentChannelId)
	if (!id) return
	dismissVolatileStreamPreview(id, { notifyEnd: false })
	if (!isChannelViewScopeCurrent(scope)) return
	const idx = store.messages.channelMessages.findIndex(m => String(m.eventId) === id)
	if (idx < 0) return
	store.messages.channelMessagesSource = store.messages.channelMessagesSource.filter(m => String(m.eventId) !== id)
	const container = getMessagesContainer()
	refreshChannelView()
	if (!isChannelViewScopeCurrent(scope)) return
	if (store.messages.channelMessagePipeline)
		await store.messages.channelMessagePipeline.deleteItem(idx)
	syncChannelActionsContext()
	updateLastMessageId()
	if (container) decorateRenderedMessages(container, false)
}
