/**
 * 【文件】public/hub/messages/messages.mjs
 * 【职责】频道消息主控：虚拟列表管道、发送/编辑、增量刷新、输入区启停与 Hub 顶栏按钮联动。
 * 【原理】`loadMessages`/`sendCurrentMessage` 驱动 `MessagePipeline` 虚拟列表与 composer 显隐。
 *   协调 `messageRender`、反应条与搜索过滤；消费 `groupStream` 增量刷新与流式槽同步。
 * 【数据结构】hubStore（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】../../../../../scripts/template、../../../../../scripts/toast、../../src/api/groupApi、../../src/groupViewerPermissions、../../src/lib/emojiSvg、../../src/MessagePipeline、../../src/ui/channelDisplay。
 */
import {
	createDocumentFragmentFromHtmlStringNoScriptActivation,
	mountTemplate,
} from '../../../../../scripts/template.mjs'
import { showToastI18n } from '../../../../../scripts/toast.mjs'
import {
	getChannelMessages,
	requestChannelHistoryFromPeers,
	sendGroupMessage,
} from '../../src/api/groupApi.mjs'
import { viewerCanAddReactions, viewerCanManageMessages, viewerCanPinMessages } from '../../src/groupViewerPermissions.mjs'
import { hubEmptyWaveIcon } from '../../src/lib/emojiSvg.mjs'
import { eventIdsEqual, normalizeEventId } from '../../src/lib/eventId.mjs'
import { createMessagePipeline } from '../../src/MessagePipeline.mjs'
import { handleUIError } from '../../src/ui/errors.mjs'
import { refreshChannelPinsBar } from '../banners.mjs'
import { getChatGestures } from '../chatGestures.mjs'
import { clearSelectedFiles, selectedFiles, stopVoiceIfRecording } from '../composerFiles.mjs'
import { activeCharPartNames } from '../core/domUtils.mjs'
import { hubStore, setHubState, watchHubState } from '../core/state.mjs'
import {
	dismissVolatileStreamPreview,
	getActiveVolatileStreamIds,
	syncStreamingSlotsFromDom,
	waitForGroupWebSocketOpen,
} from '../groupStream.mjs'
import { applyAvatarsTo } from '../presence.mjs'
import { isThreadDrawerOpen } from '../threadDrawer.mjs'

import {
	consumePendingScrollTarget,
	ensureMessageLoaded,
	fetchRowsForMessageEvent,
	mergeIncrementalSourceBatch,
	refreshChannelMessagesView,
	setPendingScrollTarget,
} from './channelMessageStore.mjs'
import {
	cancelScheduledChannelRefresh,
	scheduleDebouncedChannelRefresh,
} from './channelRefreshScheduler.mjs'
import { loadNonTextChannel } from './channelTypeRouter.mjs'
import { bindChannelMessageActions } from './messageActionsHandlers.mjs'
import { setChannelMessageActionsContext } from './messageActionsState.mjs'
import {
	getMessageText,
	isChannelMessageGenerating,
	localizeRenderedMessages,
	renderChannelMessageBlock,
	renderMessageReactionsHtml,
} from './messageRender.mjs'
import { wireMessageReactions } from './reactions.mjs'

/**
 *
 */
export { cancelScheduledChannelRefresh }

/** @type {HTMLElement | null} */
let cachedMessagesContainer = null

/** 虚拟列表重建后待高亮的 eventId（等待下次 onRenderComplete 消费）。 */
let pendingHighlightEventId = null

/**
 * @returns {HTMLElement | null} 消息列表根节点
 */
export function getMessagesContainer() {
	if (cachedMessagesContainer?.isConnected) return cachedMessagesContainer
	const el = document.getElementById('hub-messages')
	cachedMessagesContainer = el instanceof HTMLElement ? el : null
	return cachedMessagesContainer
}

/** @returns {void} */
function refreshChannelView() {
	refreshChannelMessagesView(getMessageText)
}

/** @returns {void} */
function updateLastMessageId() {
	const last = hubStore.channelMessagesSource.at(-1)
	hubStore.lastMessageId = last?.eventId || null
}

/** 销毁当前频道虚拟列表。 @returns {void} */
function destroyChannelVirtualList() {
	hubStore.channelMessagePipeline?.destroy()
	hubStore.channelMessagePipeline = null
}

/**
 * @param {HTMLElement} container 消息列表容器
 * @param {boolean} [shouldScroll=false] 是否滚到底部
 * @returns {void}
 */
function decorateRenderedMessages(container, shouldScroll = false) {
	localizeRenderedMessages(container)
	syncStreamingSlotsFromDom(container)
	applyAvatarsTo(container)
	bindReactions(container)
	bindChannelMessageActions(container)
	if (isTwoPartyCharDialogue()) {
		const gestures = getChatGestures()
		gestures.updateHideCharNames(hubStore.channelMessages)
		gestures.attachLastCharMessageSwipe(container)
	}
	if (shouldScroll) scrollToBottom()
	if (pendingHighlightEventId) {
		const sel = messageIdSelector(pendingHighlightEventId)
		const row = sel ? container.querySelector(sel) : null
		if (row instanceof HTMLElement) {
			pendingHighlightEventId = null
			highlightMessageRow(row)
		}
	}
}

/**
 * @param {HTMLElement} container 消息列表根节点
 * @param {object[]} reactionEvents 本轮 reaction DAG 行
 * @returns {Promise<void>}
 */
async function patchReactionRows(container, reactionEvents) {
	hubStore.channelReactionEvents = reactionEvents
	const opts = messageRenderOpts()
	for (const message of hubStore.channelMessages) {
		if (message.type !== 'message' || !message.eventId) continue
		const eventId = String(message.eventId)
		const row = container.querySelector(messageIdSelector(eventId))
		if (!row) continue
		const html = await renderMessageReactionsHtml(
			message,
			hubStore.channelMessages,
			reactionEvents,
			opts.viewerMemberId,
			{ canAddReactions: opts.canAddReactions },
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
	bindReactions(container)
}

/**
 * @param {object} message 消息行
 * @param {number} index 全局索引
 * @returns {Promise<HTMLElement>} 渲染后的消息节点
 */
async function renderChannelMessageElement(message, index) {
	const prev = index > 0 ? hubStore.channelMessages[index - 1] : null
	const lastId = hubStore.channelMessages.at(-1)?.eventId
	const block = await renderChannelMessageBlock(
		message,
		prev?.charId ?? prev?.sender ?? null,
		prev?.timestamp || 0,
		hubStore.channelMessages,
		{ ...messageRenderOpts(), lastMessageEventId: lastId },
	)
	const frag = await createDocumentFragmentFromHtmlStringNoScriptActivation(block.html)
	return frag.firstElementChild
}

/**
 * @returns {Promise<number>} 新增加的展示条数
 */
async function loadOlderMessages() {
	if (hubStore.channelOlderExhausted.value || !hubStore.currentGroupId || !hubStore.currentChannelId) return 0
	const oldest = hubStore.channelMessages[0]
	const oldestId = oldest?.eventId
	if (!oldestId || String(oldestId).startsWith('pending:')) {
		hubStore.channelOlderExhausted.value = true
		return 0
	}
	const limit = Math.max(1, Math.ceil(hubStore.channelMessages.length / 2))
	let batch = []
	try {
		const { messages } = await getChannelMessages(hubStore.currentGroupId, hubStore.currentChannelId, {
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
			batch = await requestChannelHistoryFromPeers(hubStore.currentGroupId, hubStore.currentChannelId, {
				before: oldestId,
				limit,
			})
		}
		catch {
			batch = []
		}

	if (!batch.length) {
		hubStore.channelOlderExhausted.value = true
		return 0
	}
	const known = new Set(
		hubStore.channelMessagesSource.map(m => String(m.eventId)).filter(Boolean),
	)
	const fresh = batch.filter(m => {
		const eventId = String(m.eventId)
		return eventId && !known.has(eventId)
	})
	if (!fresh.length) {
		hubStore.channelOlderExhausted.value = true
		return 0
	}
	hubStore.channelMessagesSource = [...fresh, ...hubStore.channelMessagesSource]
	refreshChannelView()
	syncChannelActionsContext()
	return fresh.length
}

/**
 * @param {HTMLElement} container 消息容器
 * @returns {void}
 */
function initChannelVirtualList(container) {
	destroyChannelVirtualList()
	hubStore.channelMessagePipeline = createMessagePipeline({
		container,
		loadMoreTop: loadOlderMessages,
		/**
		 * @param {number} offset 起始索引
		 * @param {number} limit 条数
		 * @returns {Promise<{ items: object[], total: number }>} 分页数据
		 */
		fetchData: async (offset, limit) => {
			if (limit === 0) return { items: [], total: hubStore.channelMessages.length }
			return {
				items: hubStore.channelMessages.slice(offset, offset + limit),
				total: hubStore.channelMessages.length,
			}
		},
		/**
		 * @param {object} item 消息行
		 * @param {number} index 索引
		 * @returns {Promise<HTMLElement>} 消息行元素
		 */
		renderItem: (item, index) => renderChannelMessageElement(item, index),
		initialIndex: (() => {
			const targetId = consumePendingScrollTarget()
			if (!targetId) return Math.max(0, hubStore.channelMessages.length - 1)
			const norm = normalizeEventId(targetId)
			const idx = hubStore.channelMessages.findIndex(
				m => eventIdsEqual(m.eventId, norm),
			)
			return idx >= 0 ? idx : Math.max(0, hubStore.channelMessages.length - 1)
		})(),
		/** @returns {void} */
		onRenderComplete: () => decorateRenderedMessages(container),
	})
}

/** @returns {Promise<void>} */
export async function refreshReactionPerms() {
	if (!hubStore.currentState || !hubStore.currentGroupId || !hubStore.currentChannelId) {
		hubStore.reactionRenderOpts = { viewerMemberId: 'local', canAddReactions: false, canManageMessages: false, canPinMessages: false }
		return
	}
	const viewerMemberId = hubStore.currentState.viewerMemberPubKeyHash || 'local'
	const [canAddReactions, canManageMessages, canPinMessages] = await Promise.all([
		viewerCanAddReactions(hubStore.currentState, hubStore.currentGroupId, hubStore.currentChannelId),
		viewerCanManageMessages(hubStore.currentState, hubStore.currentGroupId, hubStore.currentChannelId),
		viewerCanPinMessages(hubStore.currentState, hubStore.currentGroupId, hubStore.currentChannelId),
	])
	hubStore.reactionRenderOpts = { viewerMemberId, canAddReactions, canManageMessages, canPinMessages }
}

/** @returns {boolean} 是否双人角色对话 */
function isTwoPartyCharDialogue() {
	if (hubStore.privateGroup.charName) return true
	const state = hubStore.currentState
	if (!state) return false
	const charCount = state.charPartNames?.length ?? 0
	const activeMembers = Object.values(state.members).filter(member => member?.status === 'active').length
	return charCount === 1 && activeMembers <= 2
}

/** @returns {object} 消息渲染选项 */
export function messageRenderOpts() {
	const pinnedEventIds = hubStore.currentChannelId && hubStore.currentState?.pinsByChannel?.[hubStore.currentChannelId]
		? [...hubStore.currentState.pinsByChannel[hubStore.currentChannelId]]
		: []
	return {
		reactionEvents: hubStore.channelReactionEvents,
		viewerMemberId: hubStore.reactionRenderOpts.viewerMemberId,
		canAddReactions: hubStore.reactionRenderOpts.canAddReactions,
		viewerPubKeyHash: hubStore.currentState?.viewerMemberPubKeyHash || null,
		localCharIds: activeCharPartNames(),
		canManageMessages: hubStore.reactionRenderOpts.canManageMessages,
		canPinMessages: hubStore.reactionRenderOpts.canPinMessages,
		pinnedEventIds,
		alwaysVisibleActions: isTwoPartyCharDialogue(),
		canCreateThreads: !!hubStore.currentState?.channelCaps?.[hubStore.currentChannelId]?.canCreateThreads,
	}
}

/** @returns {void} */
export function syncChannelActionsContext() {
	setChannelMessageActionsContext({
		groupId: hubStore.currentGroupId,
		channelId: hubStore.currentChannelId,
		messages: hubStore.channelMessages,
		reload: loadMessages,
	})
}

/** @param {HTMLElement} container @returns {void} */
export function bindReactions(container) {
	wireMessageReactions(container, {
		groupId: hubStore.currentGroupId,
		channelId: hubStore.currentChannelId,
		messages: hubStore.channelMessages,
		reactionEvents: hubStore.channelReactionEvents,
		viewerMemberId: hubStore.reactionRenderOpts.viewerMemberId,
		canManageMessages: hubStore.reactionRenderOpts.canManageMessages,
		reload: loadMessages,
	})
}

/**
 * 刷新虚表（搜索/overlay 全量变更）。
 * @param {HTMLElement} container 消息列表根节点
 * @param {boolean} [scrollBottom=false] 是否滚到底部
 * @returns {Promise<void>}
 */
export async function refreshChannelViewDom(container, scrollBottom = false) {
	refreshChannelView()
	syncChannelActionsContext()
	if (!hubStore.channelMessages.length) {
		destroyChannelVirtualList()
		await mountTemplate(container, 'hub/empty/idle', { iconHtml: hubEmptyWaveIcon })
		hubStore.lastMessageId = null
		return
	}
	if (!hubStore.channelMessagePipeline)
		initChannelVirtualList(container)
	else
		await hubStore.channelMessagePipeline.refresh()
	updateLastMessageId()
	if (scrollBottom) scrollToBottom()
}

/** @returns {Promise<void>} */
export async function loadMessages() {
	hubStore.channelSearchQuery = null
	const searchInput = document.getElementById('hub-header-search')
	if (searchInput instanceof HTMLInputElement) searchInput.value = ''
	const container = getMessagesContainer()
	const channel = hubStore.currentState?.channels?.[hubStore.currentChannelId]
	await mountTemplate(container, 'hub/empty/loading', {})
	destroyChannelVirtualList()
	if (await loadNonTextChannel(container, channel)) return
	try {
		hubStore.composerPendingId = null
		hubStore.channelOlderExhausted.value = false
		const { messages, reactionEvents } = await getChannelMessages(
			hubStore.currentGroupId,
			hubStore.currentChannelId,
			{ limit: 50 },
		)
		hubStore.channelReactionEvents = reactionEvents
		hubStore.reactionEventsEtag = reactionEvents.map(e => e.eventId).sort().join(',')
		hubStore.channelMessagesSource = messages
		refreshChannelView()
		await refreshReactionPerms()
		syncChannelActionsContext()
		if (!messages.length) {
			await mountTemplate(container, 'hub/empty/idle', { iconHtml: hubEmptyWaveIcon })
			hubStore.lastMessageId = null
			return
		}
		container.innerHTML = ''
		initChannelVirtualList(container)
		updateLastMessageId()
		scrollToBottom()
		refreshChannelPinsBar()
	}
	catch (err) {
		const error = handleUIError(err, 'chat.hub.loadMessagesFailed')
		await mountTemplate(container, 'hub/empty/error', {
			i18nKey: 'chat.hub.loadMessagesFailed',
			errorMessage: error.message,
		})
	}
}

/** @returns {void} */
export function scrollToBottom() {
	const container = getMessagesContainer()
	if (!container) return
	container.scrollTop = container.scrollHeight
}

/**
 * @param {string} eventId 消息 event id
 * @returns {boolean} 是否为乐观 pending 行
 */
function isPendingEventId(eventId) {
	return String(eventId || '').startsWith('pending:')
}

/**
 * 合并增量消息批次并清理已确认的 composer pending 行。
 * @param {import('./channelMessageStore.mjs').ChannelMessageSource} source 当前消息源
 * @param {object[]} batch 增量行
 * @returns {import('./channelMessageStore.mjs').ChannelMessageSource} 合并后的源
 */
function mergeIncrementalChannelBatch(source, batch) {
	const pendingId = hubStore.composerPendingId
	const merged = mergeIncrementalSourceBatch(source, batch, pendingId)
	if (pendingId && batch.some(row => String(row.eventId) !== pendingId))
		hubStore.composerPendingId = null
	return merged
}

/**
 * @param {string} messageId 消息 id
 * @returns {string} querySelector 安全选择器
 */
function messageIdSelector(messageId) {
	const eventId = String(messageId || '')
	if (!eventId) return ''
	const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(eventId) : eventId
	return `[data-message-id="${escaped}"]`
}

/**
 * 高亮并滚动到已渲染的消息行。
 * @param {HTMLElement} row 消息 DOM 节点
 * @returns {void}
 */
function highlightMessageRow(row) {
	row.scrollIntoView({ behavior: 'smooth', block: 'center' })
	row.classList.add('ring-2', 'ring-primary', 'ring-offset-2')
	setTimeout(() => row.classList.remove('ring-2', 'ring-primary', 'ring-offset-2'), 2000)
}

/**
 * 虚拟列表重建后定位到 eventId（数据已由 ensureMessageLoaded 合并）。
 * @param {HTMLElement} container 消息列表根节点
 * @param {string} eventId 目标 event id
 * @returns {void}
 */
function rebuildVirtualListAtEvent(container, eventId) {
	setPendingScrollTarget(eventId)
	destroyChannelVirtualList()
	initChannelVirtualList(container)
	decorateRenderedMessages(container, false)
}

/**
 * 滚动到指定 DAG 消息（引用条、置顶、书签等）。
 * @param {string} eventId 消息 event id
 * @returns {Promise<void>}
 */
export async function scrollToMessageEventId(eventId) {
	const norm = String(eventId || '').trim()
	if (!norm) return
	const container = getMessagesContainer()
	if (!container) return

	const sel = messageIdSelector(norm)
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

	if (hubStore.channelMessages.length) {
		pendingHighlightEventId = norm
		rebuildVirtualListAtEvent(container, norm)
	}

	row = sel ? container.querySelector(sel) : null
	if (row instanceof HTMLElement) {
		pendingHighlightEventId = null
		highlightMessageRow(row)
	}
}

/**
 *
 */
export { ensureMessageLoaded } from './channelMessageStore.mjs'

/**
 * 将 POST 落盘的 DAG 事件转为频道消息行。
 * @param {object} event 签名后 `message` 事件
 * @returns {object} 频道消息行
 */
function channelRowFromPostedEvent(event) {
	const eventId = event?.id
	const viewerPubKeyHash = String(hubStore.currentState?.viewerMemberPubKeyHash || '').trim().toLowerCase()
	const authorPubKeyHash = String(event.sender || '').trim().toLowerCase()
	return {
		eventId,
		type: 'message',
		content: event.content,
		sender: event.sender,
		charId: event.charId || null,
		timestamp: event.hlc?.wall ?? Date.now(),
		authorPubKeyHash,
		isRemote: !!(authorPubKeyHash && viewerPubKeyHash && authorPubKeyHash !== viewerPubKeyHash),
	}
}

/**
 * @param {string} content 正文
 * @param {string} tempId 临时 id
 * @returns {object} 待发送占位行
 */
function pendingRowFromComposer(content, tempId) {
	const viewerPubKeyHash = hubStore.currentState?.viewerMemberPubKeyHash || null
	return {
		eventId: tempId,
		pending: true,
		type: 'message',
		content: { type: 'text', content },
		sender: viewerPubKeyHash,
		authorPubKeyHash: viewerPubKeyHash,
		timestamp: Date.now(),
		isRemote: false,
	}
}

/**
 * 乐观插入待发送行。
 * @param {string} content 正文
 * @param {string} tempId 临时 id
 * @returns {Promise<void>}
 */
async function insertPendingRow(content, tempId) {
	hubStore.composerPendingId = tempId
	const row = pendingRowFromComposer(content, tempId)
	const container = getMessagesContainer()
	if (!container) return
	hubStore.channelMessagesSource = mergeIncrementalChannelBatch(hubStore.channelMessagesSource, [row])
	refreshChannelView()
	syncChannelActionsContext()
	if (container.querySelector('.hub-empty')) container.innerHTML = ''
	if (!hubStore.channelMessagePipeline) initChannelVirtualList(container)
	const visible = hubStore.channelMessages.find(m => String(m.eventId) === tempId)
	if (visible) await hubStore.channelMessagePipeline.appendItem(visible, true)
	decorateRenderedMessages(container, true)
}

/**
 * POST 成功后替换 pending 行。
 * @param {string} tempId 临时 id
 * @param {object} event DAG 事件
 * @returns {Promise<void>}
 */
async function confirmPendingRow(tempId, event) {
	hubStore.composerPendingId = null
	const realRow = channelRowFromPostedEvent(event)
	const realId = String(realRow.eventId)
	const container = getMessagesContainer()
	hubStore.channelMessagesSource = mergeIncrementalChannelBatch(
		hubStore.channelMessagesSource.filter(m => String(m.eventId) !== tempId),
		[realRow],
	)
	refreshChannelView()
	if (hubStore.channelMessagePipeline)
		await hubStore.channelMessagePipeline.refresh()
	syncChannelActionsContext()
	updateLastMessageId()
	if (container) decorateRenderedMessages(container, false)
}

/**
 * 发送失败时移除 pending 行。
 * @param {string} tempId 临时 id
 * @returns {Promise<void>}
 */
/**
 * 发送失败：保留行并标记可重试。
 * @param {string} tempId 临时 id
 * @param {string} content 正文
 * @param {File[]} [files] 附件
 * @returns {Promise<void>}
 */
async function failPendingRow(tempId, content, files = []) {
	const idx = hubStore.channelMessagesSource.findIndex(m => String(m.eventId) === tempId)
	if (idx >= 0)
		hubStore.channelMessagesSource[idx] = {
			...hubStore.channelMessagesSource[idx],
			sendFailed: true,
			pending: true,
		}

	hubStore.failedPendingPayloads.set(tempId, { content, files: [...files] })
	refreshChannelView()
	const container = getMessagesContainer()
	if (hubStore.channelMessagePipeline)
		await hubStore.channelMessagePipeline.refresh()
	syncChannelActionsContext()
	if (container) decorateRenderedMessages(container, false)
}

/**
 * @param {string} tempId 临时 id
 * @returns {Promise<void>}
 */
export async function retryFailedPendingMessage(tempId) {
	const payload = hubStore.failedPendingPayloads.get(tempId)
	if (!payload) return
	hubStore.failedPendingPayloads.delete(tempId)
	const idx = hubStore.channelMessagesSource.findIndex(m => String(m.eventId) === tempId)
	if (idx >= 0)
		hubStore.channelMessagesSource[idx] = {
			...hubStore.channelMessagesSource[idx],
			sendFailed: false,
			pending: true,
		}

	hubStore.composerPendingId = tempId
	refreshChannelView()
	try {
		const event = await sendGroupMessage(
			hubStore.currentGroupId,
			hubStore.currentChannelId,
			payload.content,
			payload.files?.length ? payload.files : undefined,
		)
		await confirmPendingRow(tempId, event)
	}
	catch (error) {
		await failPendingRow(tempId, payload.content, payload.files)
		throw error
	}
}

/**
 * 单条消息增量写入虚表（唯一 DOM 更新入口）。
 * @param {object} message API/WS 消息行
 * @param {{ scroll?: boolean }} [options] 是否滚动到底
 * @returns {Promise<void>}
 */
async function applyIncomingMessage(message, { scroll = false } = {}) {
	const container = getMessagesContainer()
	if (!container) return

	const eventId = String(message.eventId || '')
	if (!eventId) return

	if (getActiveVolatileStreamIds().some(streamId => eventIdsEqual(streamId, eventId)) && !isChannelMessageGenerating(message))
		dismissVolatileStreamPreview(eventId, { notifyEnd: false })

	const hadInSource = hubStore.channelMessagesSource.some(m => String(m.eventId) === eventId)
	hubStore.channelMessagesSource = mergeIncrementalChannelBatch(hubStore.channelMessagesSource, [message])
	refreshChannelView()

	if (container.querySelector('.hub-empty')) container.innerHTML = ''
	if (!hubStore.channelMessagePipeline) initChannelVirtualList(container)

	const viewIdx = hubStore.channelMessages.findIndex(m => String(m.eventId) === eventId)
	const row = viewIdx >= 0 ? hubStore.channelMessages[viewIdx] : null
	if (row)
		if (hadInSource)
			await hubStore.channelMessagePipeline.replaceItem(viewIdx, row)
		else
			await hubStore.channelMessagePipeline.appendItem(row, scroll)
	else
		await hubStore.channelMessagePipeline.refresh()

	if (!isThreadDrawerOpen()) syncChannelActionsContext()
	updateLastMessageId()
	decorateRenderedMessages(container, scroll)
}

/**
 * @param {object[]} batch 本轮 API 返回行
 * @param {{ scroll?: boolean }} [options] 是否滚动到底
 * @returns {Promise<void>}
 */
async function applyIncomingMessageBatch(batch, { scroll = false } = {}) {
	const container = getMessagesContainer()
	if (!container || !Array.isArray(batch) || !batch.length) {
		if (container && scroll) scrollToBottom()
		return
	}

	const oldIds = new Set(hubStore.channelMessagesSource.map(row => String(row.eventId || '')))
	hubStore.channelMessagesSource = mergeIncrementalChannelBatch(hubStore.channelMessagesSource, batch)
	refreshChannelView()

	if (container.querySelector('.hub-empty')) container.innerHTML = ''
	if (!hubStore.channelMessagePipeline) initChannelVirtualList(container)

	/** @type {{ index: number, row: object }[]} */
	const replaceRows = []
	/** @type {object[]} */
	const appendRows = []
	for (const message of batch) {
		const eventId = String(message?.eventId || '')
		if (!eventId) continue
		const viewIndex = hubStore.channelMessages.findIndex(row => String(row.eventId) === eventId)
		if (viewIndex < 0) continue
		const row = hubStore.channelMessages[viewIndex]
		if (oldIds.has(eventId))
			replaceRows.push({ index: viewIndex, row })
		else
			appendRows.push(row)
	}

	for (const { index, row } of replaceRows)
		await hubStore.channelMessagePipeline.replaceItem(index, row)
	if (appendRows.length)
		await hubStore.channelMessagePipeline.appendItemsBatch(appendRows, scroll)
	if (!replaceRows.length && !appendRows.length)
		await hubStore.channelMessagePipeline.refresh()

	if (!isThreadDrawerOpen()) syncChannelActionsContext()
	updateLastMessageId()
	decorateRenderedMessages(container, scroll)
}

/**
 * @param {{ immediate?: boolean }} [options] `immediate` 时跳过防抖（流式占位须尽快入列）
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
 * 用服务端物化行更新单条消息（流式终稿 / 编辑）。
 * @param {string} targetId 目标 message eventId
 * @returns {Promise<void>}
 */
export async function applyChannelMessageEdit(targetId) {
	const id = String(targetId || '').trim()
	if (!id || !hubStore.currentGroupId || !hubStore.currentChannelId) return
	dismissVolatileStreamPreview(id, { notifyEnd: false })

	const rows = await fetchRowsForMessageEvent(hubStore.currentGroupId, hubStore.currentChannelId, id)
	const row = rows.find(m => eventIdsEqual(m.eventId, id))
	if (!row) {
		scheduleChannelIncrementalRefresh({ immediate: true })
		return
	}
	await replaceChannelMessageRow(id, row)
}

/**
 * 从展示列表移除已删除消息。
 * @param {string} targetId 被删 message eventId
 * @returns {Promise<void>}
 */
export async function applyChannelMessageDelete(targetId) {
	const id = String(targetId || '').trim()
	if (!id) return
	dismissVolatileStreamPreview(id, { notifyEnd: false })
	const idx = hubStore.channelMessages.findIndex(m => String(m.eventId) === id)
	if (idx < 0) return
	hubStore.channelMessagesSource = hubStore.channelMessagesSource.filter(m => String(m.eventId) !== id)
	const container = getMessagesContainer()
	refreshChannelView()
	if (hubStore.channelMessagePipeline)
		await hubStore.channelMessagePipeline.deleteItem(idx)
	syncChannelActionsContext()
	updateLastMessageId()
	if (container) decorateRenderedMessages(container, false)
}

/**
 * @param {string} eventId 消息 eventId
 * @param {object} row 服务端物化行
 * @returns {Promise<void>}
 */
async function replaceChannelMessageRow(eventId, row) {
	const id = String(eventId).trim()
	const sourceIdx = hubStore.channelMessagesSource.findIndex(
		message => eventIdsEqual(message?.eventId, id),
	)
	if (sourceIdx >= 0)
		hubStore.channelMessagesSource[sourceIdx] = row
	else
		hubStore.channelMessagesSource = mergeIncrementalChannelBatch(hubStore.channelMessagesSource, [row])
	refreshChannelView()

	const container = getMessagesContainer()
	if (!container) return
	if (container.querySelector('.hub-empty')) container.innerHTML = ''
	if (!hubStore.channelMessagePipeline) initChannelVirtualList(container)
	const viewIdx = hubStore.channelMessages.findIndex(
		message => eventIdsEqual(message?.eventId, id),
	)
	const viewRow = viewIdx >= 0 ? hubStore.channelMessages[viewIdx] : null
	if (viewRow && hubStore.channelMessagePipeline) 
		await hubStore.channelMessagePipeline.replaceItem(viewIdx, viewRow)
	
	else if (hubStore.channelMessagePipeline)
		await hubStore.channelMessagePipeline.refresh()
	syncChannelActionsContext()
	updateLastMessageId()
	decorateRenderedMessages(container, false)
}

/** @returns {Promise<void>} */
export async function refreshChannelMessagesIncremental() {
	const searchActive = !!hubStore.channelSearchQuery
	if (!hubStore.currentGroupId || !hubStore.currentChannelId) return
	const chType = hubStore.currentState?.channels?.[hubStore.currentChannelId]?.type || 'text'
	if (chType === 'list' || chType === 'streaming') return

	const container = getMessagesContainer()
	if (!container) return

	const options = { limit: 50 }
	if (hubStore.lastMessageId)
		options.since = hubStore.lastMessageId

	const { messages, reactionEvents } = await getChannelMessages(
		hubStore.currentGroupId,
		hubStore.currentChannelId,
		options,
	)
	const reactionSig = reactionEvents.map(e => e.eventId).sort().join(',')
	if (!messages.length && !reactionSig) return

	if (searchActive) {
		if (reactionSig !== hubStore.reactionEventsEtag) {
			hubStore.reactionEventsEtag = reactionSig
			hubStore.channelReactionEvents = reactionEvents
		}
		if (messages.length) {
			hubStore.channelMessagesSource = mergeIncrementalChannelBatch(
				hubStore.channelMessagesSource,
				messages,
			)
			updateLastMessageId()
		}
		return
	}

	if (container.querySelector('.hub-empty')) container.innerHTML = ''

	const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
	if (reactionSig !== hubStore.reactionEventsEtag) {
		hubStore.reactionEventsEtag = reactionSig
		await patchReactionRows(container, reactionEvents)
		if (!messages.length) return
	}
	hubStore.channelReactionEvents = reactionEvents
	await applyIncomingMessageBatch(messages, { scroll: nearBottom })
}

/**
 * @param {string} content 消息正文
 * @returns {Promise<void>}
 */
export async function sendCurrentMessage(content) {
	const sendGroupId = hubStore.currentGroupId
	const sendChannelId = hubStore.currentChannelId
	if (!sendGroupId || !sendChannelId)
		throw new Error('no channel selected')
	await waitForGroupWebSocketOpen(sendGroupId, sendChannelId)
	const files = [...selectedFiles]
	const tempId = `pending:${crypto.randomUUID()}`
	await insertPendingRow(content, tempId)
	try {
		const event = await sendGroupMessage(sendGroupId, sendChannelId, content, files)
		if (hubStore.currentGroupId !== sendGroupId || hubStore.currentChannelId !== sendChannelId) {
			hubStore.composerPendingId = null
			hubStore.channelMessagesSource = hubStore.channelMessagesSource.filter(m => String(m.eventId) !== tempId)
			clearSelectedFiles()
			hubStore.failedPendingPayloads.delete(tempId)
			return
		}
		clearSelectedFiles()
		hubStore.failedPendingPayloads.delete(tempId)
		await confirmPendingRow(tempId, event)
	}
	catch (error) {
		if (hubStore.currentGroupId === sendGroupId && hubStore.currentChannelId === sendChannelId)
			await failPendingRow(tempId, content, files)
		else {
			hubStore.composerPendingId = null
			hubStore.channelMessagesSource = hubStore.channelMessagesSource.filter(m => String(m.eventId) !== tempId)
		}
		throw error
	}
}

/** @returns {Promise<void>} */
export async function submitComposer() {
	const input = document.getElementById('hub-message-input')
	if (input.disabled) return
	await stopVoiceIfRecording()
	const content = input.value.trim()
	if (!content && !selectedFiles.length) return
	if (!hubStore.currentGroupId || !hubStore.currentChannelId) return
	input.value = ''
	if (input instanceof HTMLTextAreaElement)
		input.style.height = 'auto'
	try {
		await sendCurrentMessage(content)
	}
	catch (err) {
		showToastI18n('error', 'chat.hub.sendFailed', { error: err.message })
		input.value = content
		if (input instanceof HTMLTextAreaElement)
			input.dispatchEvent(new Event('input', { bubbles: true }))
	}
}

watchHubState('focusedMessageEventId', eventId => {
	if (!eventId) return
	void scrollToMessageEventId(String(eventId)).finally(() => setHubState('focusedMessageEventId', null))
})

/**
 * 订阅式跳转到消息（写入 hubStore.focusedMessageEventId）。
 * @param {string | null} eventId 目标 eventId
 * @returns {void}
 */
export function focusMessageEventId(eventId) {
	setHubState('focusedMessageEventId', eventId ? String(eventId).trim() : null)
}

/**
 * 转发 composer 启停与顶栏按钮刷新（由 composerController 实现）。
 */
export { disableComposer, enableComposer, refreshHubHeaderButtons } from './composerController.mjs'
