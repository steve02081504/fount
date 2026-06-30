/**
 * 【文件】public/hub/threadDrawer.mjs
 * 【职责】消息线程侧抽屉：打开/关闭子频道线程视图，并在主频道 WS 事件时刷新活跃线程。
 * 【原理】`openThread` / `closeThreadDrawer` 控制 `#hub-thread-drawer` 与线程内消息列表容器；线程频道复用 `messages` 加载与渲染路径；`refreshActiveThreadIfOpen` 在父频道更新后同步。
 * 【数据结构】hubStore（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】线程子频道 ID 写入 `hubStore`；主 hash 仍描述父群/父频道。
 */
import {
	createDocumentFragmentFromHtmlStringNoScriptActivation,
	mountTemplate,
	usingTemplates,
} from '../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import {
	createChannelThread,
	getChannelMessages,
	getGroupState,
	sendGroupMessage,
} from '../src/api/groupApi.mjs'
import { applyChannelDisplayChain } from '../src/ui/channelDisplay.mjs'

import { activeCharPartNames } from './core/domUtils.mjs'
import { hubStore } from './core/state.mjs'
import { bindChannelMessageActions } from './messages/messageActionsHandlers.mjs'
import { setChannelMessageActionsContext } from './messages/messageActionsState.mjs'
import { localizeRenderedMessages, renderChannelMessageBlock } from './messages/messageRender.mjs'
import { syncChannelActionsContext } from './messages/messages.mjs'
import { wireMessageReactions } from './messages/reactions.mjs'
import { applyAvatarsTo } from './presence.mjs'

/** @type {{ groupId: string, parentChannelId: string, threadChannelId: string, parentEventId: string, messages: object[], reactionEvents: object[] } | null} */
let activeThread = null

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
	const wrap = document.getElementById('hub-thread-drawer-wrap')
	if (!wrap) return
	wrap.setAttribute('hidden', '')
	wrap.replaceChildren()
	activeThread = null
	syncChannelActionsContext()
}

/**
 * 组装子线程消息渲染选项。
 * @param {string} threadChannelId 子线程频道 ID
 * @param {object[]} reactionEvents 反应事件
 * @returns {object} 渲染选项
 */
function threadMessageRenderOpts(threadChannelId, reactionEvents) {
	const pinnedEventIds = hubStore.currentState?.pinsByChannel?.[threadChannelId]
		? [...hubStore.currentState.pinsByChannel[threadChannelId]]
		: []
	return {
		reactionEvents: reactionEvents || [],
		viewerMemberId: hubStore.reactionRenderOpts.viewerMemberId,
		canAddReactions: hubStore.reactionRenderOpts.canAddReactions,
		viewerPubKeyHash: hubStore.currentState?.viewerMemberPubKeyHash || null,
		localCharIds: activeCharPartNames(),
		canManageMessages: hubStore.reactionRenderOpts.canManageMessages,
		canPinMessages: hubStore.reactionRenderOpts.canPinMessages,
		pinnedEventIds,
		alwaysVisibleActions: false,
		canCreateThreads: false,
	}
}

/**
 * 渲染子线程消息列表并绑定交互。
 * @param {HTMLElement} messageContainer 消息容器
 * @returns {Promise<void>}
 */
async function renderThreadMessages(messageContainer) {
	if (!activeThread) return
	messageContainer.replaceChildren()
	const { groupId, threadChannelId } = activeThread
	const { messages, reactionEvents } = await getChannelMessages(groupId, threadChannelId, { limit: 80 })
	activeThread.messages = messages || []
	activeThread.reactionEvents = reactionEvents || []
	const rows = applyChannelDisplayChain(activeThread.messages)
	if (!rows.length) {
		await mountTemplate(messageContainer, 'hub/empty/idle', {})
		setChannelMessageActionsContext({
			groupId,
			channelId: threadChannelId,
			messages: [],
			/** @returns {Promise<void>} */
			reload: () => renderThreadMessages(messageContainer),
		})
		return
	}
	const opts = threadMessageRenderOpts(threadChannelId, activeThread.reactionEvents)
	let prevSender = null
	let prevTs = 0
	for (const message of rows) {
		const block = await renderChannelMessageBlock(message, prevSender, prevTs, rows, opts)
		prevSender = message.charId ?? message.sender ?? null
		prevTs = message.hlc?.wall ?? 0
		const frag = await createDocumentFragmentFromHtmlStringNoScriptActivation(block.html)
		if (frag.firstElementChild)
			messageContainer.appendChild(frag.firstElementChild)
	}
	setChannelMessageActionsContext({
		groupId,
		channelId: threadChannelId,
		messages: rows,
		/** @returns {Promise<void>} */
		reload: () => renderThreadMessages(messageContainer),
	})
	bindChannelMessageActions(messageContainer)
	wireMessageReactions(messageContainer, {
		groupId,
		channelId: threadChannelId,
		messages: rows,
		reactionEvents: activeThread.reactionEvents,
		viewerMemberId: hubStore.reactionRenderOpts.viewerMemberId,
		canManageMessages: hubStore.reactionRenderOpts.canManageMessages,
		/** @returns {Promise<void>} */
		reload: () => renderThreadMessages(messageContainer),
	})
	localizeRenderedMessages(messageContainer)
	applyAvatarsTo(messageContainer)
	messageContainer.scrollTop = messageContainer.scrollHeight
}

/**
 * 绑定子线程 composer 发送。
 * @param {HTMLElement} drawer 抽屉根节点
 * @param {HTMLElement} messageContainer 消息容器
 * @returns {void}
 */
function wireThreadComposer(drawer, messageContainer) {
	const input = drawer.querySelector('[data-thread-input]')
	const sendBtn = drawer.querySelector('[data-thread-send]')
	if (!(input instanceof HTMLInputElement) || !(sendBtn instanceof HTMLButtonElement)) return

	/**
	 * @returns {Promise<void>}
	 */
	const submit = async () => {
		if (!activeThread) return
		const text = input.value.trim()
		if (!text) return
		sendBtn.disabled = true
		try {
			await sendGroupMessage(activeThread.groupId, activeThread.threadChannelId, text)
			input.value = ''
			await renderThreadMessages(messageContainer)
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.sendFailed', { error: error.message })
		}
		finally {
			sendBtn.disabled = false
		}
	}

	sendBtn.addEventListener('click', () => { void submit() })
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
	const wrap = document.getElementById('hub-thread-drawer-wrap')
	if (!wrap) return
	usingTemplates('/parts/shells:chat/src/templates')
	try {
		const channels = hubStore.currentState?.channels || {}
		let threadChannelId = findThreadChannelId(channels, parentChannelId, parentEventId)
		const createdNew = !threadChannelId
		if (!threadChannelId)
			threadChannelId = await createChannelThread(groupId, parentChannelId, parentEventId)

		activeThread = {
			groupId,
			parentChannelId,
			threadChannelId,
			parentEventId,
			messages: [],
			reactionEvents: [],
		}
		hubStore.currentState = await getGroupState(groupId)

		wrap.removeAttribute('hidden')
		wrap.replaceChildren()
		const drawer = await mountTemplate(wrap, 'thread_drawer', {})
		const titleEl = drawer.querySelector('[data-thread-title]')
		if (titleEl)
			titleEl.textContent = title || `thread:${parentEventId.slice(0, 12)}`
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
