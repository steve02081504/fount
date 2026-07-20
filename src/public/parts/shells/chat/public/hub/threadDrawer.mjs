/**
 * 【文件】public/hub/threadDrawer.mjs
 * 【职责】消息线程侧抽屉：打开/关闭子频道线程视图，并在主频道 WS 事件时刷新活跃线程。
 * 【原理】线程消息面复用 `messageSurface` 的 MessagePipeline + bind；主 hash 仍描述父群/父频道。
 */
import {
	mountTemplate,
	usingTemplates,
} from '../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { createChannelThread, getChannelViewLog, sendGroupMessage } from '../src/api/groupChannel.mjs'
import { getGroupState } from '../src/api/groupCore.mjs'
import { applyChannelDisplayChain } from '../src/ui/channelDisplay.mjs'

import { store } from './core/state.mjs'
import { setChannelMessageActionsContext } from './messages/messageActionsState.mjs'
import {
	bindMessageSurface,
	buildChannelRenderOpts,
	createMessageSurfacePipeline,
} from './messages/messageSurface.mjs'

/** @type {{ groupId: string, parentChannelId: string, threadChannelId: string, parentEventId: string, messages: object[], reactions: Record<string, Record<string, { voters?: string[] }>> } | null} */
let activeThread = null
/** 渲染代际：并发 renderThreadMessages 仅最新一代可写 DOM */
let threadRenderGeneration = 0
/** @type {ReturnType<typeof createMessageSurfacePipeline> | null} */
let threadPipeline = null

/** @returns {boolean} 子线程抽屉是否打开 */
export function isThreadDrawerOpen() {
	return !!activeThread
}

/**
 * 判断频道是否为子线程。
 * @param {object} channel 频道物化对象
 * @returns {boolean} 是否为子线程频道
 */
export function isThreadChannel(channel) {
	return !!(channel?.parentChannelId && channel?.parentEventId)
}

/**
 * 在群 state 中查找已存在的子线程频道 ID。
 * @param {Record<string, object>} channels 频道表
 * @param {string} parentChannelId 父频道 ID
 * @param {string} parentEventId 父消息事件 ID
 * @returns {string | null} 已存在的子线程频道 ID
 */
function findThreadChannelId(channels, parentChannelId, parentEventId) {
	const eventNorm = String(parentEventId).trim().toLowerCase()
	for (const [id, ch] of Object.entries(channels)) {
		if (ch?.parentChannelId !== parentChannelId) continue
		if (ch?.parentEventId && String(ch.parentEventId).trim().toLowerCase() === eventNorm)
			return id
	}
	return null
}

/** @returns {string | null} 当前打开的子线程频道 ID */
export function getActiveThreadChannelId() {
	return activeThread?.threadChannelId ?? null
}

/**
 * @returns {void}
 */
function destroyThreadPipeline() {
	threadPipeline?.destroy()
	threadPipeline = null
}

/**
 * 群 WS 通知子线程频道有变更时刷新抽屉。
 * @returns {Promise<void>}
 */
export async function refreshActiveThreadIfOpen() {
	if (!activeThread) return
	const messageContainer = document.querySelector('[data-thread-msgbox]')
	if (messageContainer instanceof HTMLElement)
		await renderThreadMessages(messageContainer)
}

/**
 * 关闭子线程抽屉。
 * @returns {void}
 */
export function closeThreadDrawer() {
	const wrap = document.getElementById('thread-drawer-wrap')
	if (!wrap) return
	wrap.setAttribute('hidden', '')
	wrap.replaceChildren()
	destroyThreadPipeline()
	activeThread = null
	threadRenderGeneration++
	setChannelMessageActionsContext(null, 'thread')
}

/**
 * @param {string} threadChannelId 子线程频道 ID
 * @param {Record<string, Record<string, { voters?: string[] }>>} reactions 聚合反应
 * @returns {object} 渲染选项
 */
function threadMessageRenderOpts(threadChannelId, reactions) {
	return buildChannelRenderOpts({
		channelId: threadChannelId,
		reactions,
		overrides: {
			alwaysVisibleActions: false,
			canCreateThreads: false,
		},
	})
}

/**
 * @param {HTMLElement} messageContainer 消息容器
 * @returns {Promise<void>}
 */
async function reloadThreadSurface(messageContainer) {
	await renderThreadMessages(messageContainer)
}

/**
 * 渲染子线程消息列表并绑定交互（复用主区 MessagePipeline 面）。
 * @param {HTMLElement} messageContainer 消息容器
 * @returns {Promise<void>}
 */
async function renderThreadMessages(messageContainer) {
	if (!activeThread) return
	const generation = ++threadRenderGeneration
	const { groupId, threadChannelId } = activeThread
	const { messages, reactions } = await getChannelViewLog(groupId, threadChannelId, { limit: 80 })
	if (generation !== threadRenderGeneration || !activeThread) return
	activeThread.messages = messages || []
	activeThread.reactions = reactions || {}
	const rows = applyChannelDisplayChain(activeThread.messages)
	activeThread.messages = rows

	/**
	 * @returns {Promise<void>}
	 */
	const reload = () => reloadThreadSurface(messageContainer)

	if (!rows.length) {
		destroyThreadPipeline()
		messageContainer.replaceChildren()
		await mountTemplate(messageContainer, 'hub/empty/idle', {})
		if (generation !== threadRenderGeneration) return
		bindMessageSurface(messageContainer, {
			groupId,
			channelId: threadChannelId,
			messages: [],
			reactions: {},
			reload,
		})
		return
	}

	/**
	 * @returns {void}
	 */
	const decorate = () => {
		if (generation !== threadRenderGeneration || !activeThread) return
		bindMessageSurface(messageContainer, {
			groupId,
			channelId: threadChannelId,
			messages: activeThread.messages,
			reactions: activeThread.reactions,
			reload,
		})
	}

	if (threadPipeline) {
		await threadPipeline.refresh()
		if (generation !== threadRenderGeneration) return
		decorate()
		return
	}

	threadPipeline = createMessageSurfacePipeline({
		container: messageContainer,
		/** @returns {object[]} 线程消息 */
		getMessages: () => activeThread?.messages || [],
		/** @returns {object} 渲染选项 */
		getRenderOpts: () => threadMessageRenderOpts(
			activeThread?.threadChannelId || threadChannelId,
			activeThread?.reactions || {},
		),
		onDecorate: decorate,
		initialIndex: Math.max(0, rows.length - 1),
	})
}

/**
 * 绑定子线程 composer 发送。
 * @param {HTMLElement} drawer 抽屉根节点
 * @param {HTMLElement} messageContainer 消息容器
 * @returns {void}
 */
function wireThreadComposer(drawer, messageContainer) {
	const input = drawer.querySelector('[data-thread-input]')
	const sendButton = drawer.querySelector('[data-thread-send]')
	if (!(input instanceof HTMLInputElement) || !(sendButton instanceof HTMLButtonElement)) return

	/**
	 * @returns {Promise<void>}
	 */
	const submit = async () => {
		if (!activeThread) return
		const text = input.value.trim()
		if (!text) return
		sendButton.disabled = true
		try {
			await sendGroupMessage(activeThread.groupId, activeThread.threadChannelId, text)
			input.value = ''
			await renderThreadMessages(messageContainer)
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.sendFailed', { error: error.message })
		}
		finally {
			sendButton.disabled = false
		}
	}

	sendButton.addEventListener('click', () => { void submit() })
	// 子线程为单行 input：Enter 发送；主 composer 为 Ctrl/Cmd+Enter 发送（见 composerKeys.mjs）
	input.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault()
			void submit()
		}
	})
}

/**
 * 打开子线程抽屉（必要时创建子频道）。
 * @param {string} groupId 群 ID
 * @param {string} parentChannelId 父频道 ID
 * @param {string} parentEventId 父消息事件 ID
 * @param {string} [title] 抽屉标题
 * @returns {Promise<void>}
 */
export async function openThread(groupId, parentChannelId, parentEventId, title = '') {
	const wrap = document.getElementById('thread-drawer-wrap')
	if (!wrap) return
	usingTemplates('/parts/shells:chat/src/templates')
	try {
		const channels = store.context.currentState?.channels || {}
		let threadChannelId = findThreadChannelId(channels, parentChannelId, parentEventId)
		const createdNew = !threadChannelId
		if (!threadChannelId)
			threadChannelId = await createChannelThread(groupId, parentChannelId, parentEventId)

		destroyThreadPipeline()
		activeThread = {
			groupId,
			parentChannelId,
			threadChannelId,
			parentEventId,
			messages: [],
			reactions: {},
		}
		store.context.currentState = await getGroupState(groupId)

		wrap.removeAttribute('hidden')
		wrap.replaceChildren()
		const drawer = await mountTemplate(wrap, 'thread_drawer', {})
		const titleElement = drawer.querySelector('[data-thread-title]')
		if (titleElement)
			titleElement.textContent = title || `thread:${parentEventId.slice(0, 12)}`
		drawer.querySelector('[data-thread-close]')?.addEventListener('click', closeThreadDrawer)
		const messageContainer = drawer.querySelector('[data-thread-msgbox]')
		if (messageContainer instanceof HTMLElement) {
			await renderThreadMessages(messageContainer)
			wireThreadComposer(drawer, messageContainer)
		}
		if (createdNew)
			showToastI18n('success', 'chat.hub.threadCreated')
	}
	catch (error) {
		showToastI18n('error', 'chat.hub.threadCreateFailed', { error: error.message })
	}
}
