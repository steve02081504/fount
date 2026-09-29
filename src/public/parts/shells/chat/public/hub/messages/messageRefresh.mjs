import { createDocumentFragmentFromHtmlStringNoScriptActivation } from '../../../../../scripts/features/template.mjs'
import { applyMessageEditToRow } from '../../shared/messageMerge.mjs'
import { getChannelViewLog } from '../../src/endpoints/groupChannel.mjs'
import { hubEmptyWaveIcon } from '../../src/lib/emojiSvg.mjs'
import { eventIdsEqual } from '../../src/lib/eventId.mjs'
import { mountTemplate } from '../../src/templates.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { refreshChannelPinsBar } from '../banners.mjs'
import { store } from '../core/state.mjs'
import { showNoChannelMainPane } from '../sidebar/noChannelState.mjs'
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
import { mountMessagesPlaceholder } from './messagesPlaceholder.mjs'
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
 * 判断某展示索引上的行是否真的在虚拟列表队列里（可安全 replaceItem）。
 * @param {object} pipeline 消息管道
 * @param {number} index 展示索引
 * @param {object} row 期望行
 * @returns {boolean} 队列中存在且 eventId 一致
 */
function isRowRenderedInQueue(pipeline, index, row) {
	if (!pipeline || index < 0 || !row) return false
	const queued = pipeline.virtualList?.getItem?.(index)
	return !!queued && eventIdsEqual(queued.eventId, row.eventId)
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

	const pipeline = store.messages.channelMessagePipeline
	const view = store.messages.channelMessages
	const queue = pipeline.virtualList?.getQueue?.() ?? []
	const { replaceRows, appendRows } = classifyIncomingBatch(
		batch,
		oldSource,
		view,
		queue.map(row => String(row?.eventId ?? '')),
	)

	// 目标行没真正在渲染队列里时 replaceItem 会静默 no-op / 覆盖错行，改用全量 refresh。
	const replaceNeedsRefresh = replaceRows.some(({ index, row }) => !isRowRenderedInQueue(pipeline, index, row))
	// 只有「追加行恰为展示列表尾部且队列尾正好是其前一行」时，末尾 append 才保序；否则 refresh。
	const tailStart = view.length - appendRows.length
	const appendIsTail = appendRows.length > 0
		&& appendRows.every((row, index) => String(row.eventId) === String(view[tailStart + index]?.eventId))
	const queueEndsAtTail = appendIsTail && !replaceNeedsRefresh
		&& queue.length > 0
		&& String(queue.at(-1)?.eventId) === String(view[tailStart - 1]?.eventId)

	const noRowsChanged = !replaceRows.length && !appendRows.length
	if (replaceNeedsRefresh || noRowsChanged || (appendRows.length > 0 && !queueEndsAtTail)) {
		if (!isChannelViewScopeCurrent(scope)) return
		await pipeline.refresh()
	}
	else {
		for (const { index, row } of replaceRows) {
			if (!isChannelViewScopeCurrent(scope)) return
			await pipeline.replaceItem(index, row)
		}
		if (appendRows.length && isChannelViewScopeCurrent(scope))
			await pipeline.appendItemsBatch(appendRows, scroll)
	}

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
	// 行不在渲染队列时 replaceItem 会静默 no-op（或覆盖错行），必须全量 refresh 才能落地。
	if (viewRow && isRowRenderedInQueue(store.messages.channelMessagePipeline, viewIdx, viewRow))
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
		await showNoChannelMainPane()
		return
	}
	const pipelineKey = `${groupId}:${channelId}`
	const softReload = store.messages.channelMessagePipeline
		&& store.messages.channelPipelineKey === pipelineKey
	// 同频道（含首次载入）才允许把在途乐观行带过本次载入；换频道时必须丢弃，避免串频道。
	const previousPipelineKey = store.messages.channelMessagePipeline
		? store.messages.channelPipelineKey
		: null
	const sameChannel = !previousPipelineKey || previousPipelineKey === pipelineKey
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
		store.messages.channelOlderExhausted = false
		const { messages, reactions, readMarker } = await getChannelViewLog(
			groupId,
			channelId,
			{ limit: 50 },
		)
		if (isCurrent && !isCurrent()) return
		// 载入期间发出的乐观行不能被服务端快照覆盖丢掉（否则 confirmPendingRow 无行可确认）。
		const pendingId = store.messages.composerPendingId
		const pendingRow = pendingId && sameChannel
			? store.messages.channelMessagesSource.find(row => String(row.eventId) === pendingId)
			: null
		if (pendingId && !sameChannel)
			store.messages.composerPendingId = null
		store.messages.channelReactions = reactions || {}
		store.messages.reactionsEtag = reactionsSignature(reactions)
		store.messages.channelMessagesSource = pendingRow
			? mergeIncrementalChannelBatch(messages, [pendingRow])
			: messages
		store.messages.readMarker = readMarker || null
		store.messages.firstUnreadEventId = firstUnreadEventId(readMarker, messages)
		refreshChannelView()
		await refreshReactionPerms()
		syncChannelActionsContext()
		if (!store.messages.channelMessagesSource.length) {
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
		// 管道可能仍在（宽带载入失败），必须经唯一入口销毁后再替换 #messages 子树。
		await mountMessagesPlaceholder(container, 'hub/empty/error', {
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
