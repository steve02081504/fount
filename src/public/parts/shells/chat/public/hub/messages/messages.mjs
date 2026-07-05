/**
 * 【文件】public/hub/messages/messages.mjs
 * 【职责】频道消息薄聚合：重导出子模块并绑定 Hub 状态订阅。
 */
import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { stopVoiceIfRecording } from '../composerFiles.mjs'
import { hubStore, setHubState, watchHubState } from '../core/state.mjs'

import { bindReactions, messageRenderOpts, refreshReactionPerms, syncChannelActionsContext } from './messageContext.mjs'
import {
	applyChannelMessageDelete as applyChannelMessageDeleteImpl,
	applyChannelMessageEdit as applyChannelMessageEditImpl,
	loadMessages as loadMessagesImpl,
	refreshChannelMessagesIncremental,
	refreshChannelViewDom as refreshChannelViewDomImpl,
	scheduleChannelIncrementalRefresh as scheduleChannelIncrementalRefreshImpl,
} from './messageRefresh.mjs'
import { getMessagesContainer, scrollToBottom, scrollToMessageEventId as scrollToMessageEventIdImpl } from './messageScroll.mjs'
import { retryFailedPendingMessage, sendCurrentMessage } from './messageSend.mjs'

/** @returns {void} */
function syncCtx() {
	syncChannelActionsContext(loadMessages)
}

/** @returns {Promise<void>} */
export async function loadMessages() {
	return loadMessagesImpl(loadMessages, syncCtx)
}

/**
 * @param {HTMLElement} container 消息列表容器
 * @param {boolean} [scrollBottom=false] 是否滚动到底部
 * @returns {Promise<void>}
 */
export async function refreshChannelViewDom(container, scrollBottom = false) {
	return refreshChannelViewDomImpl(container, scrollBottom, loadMessages, syncCtx)
}

/**
 * @param {{ immediate?: boolean }} [options] 刷新选项
 * @returns {void}
 */
export function scheduleChannelIncrementalRefresh(options) {
	return scheduleChannelIncrementalRefreshImpl(options, loadMessages, syncCtx)
}

/**
 * @param {string} targetId 目标消息 eventId
 * @returns {Promise<void>}
 */
export async function applyChannelMessageEdit(targetId) {
	return applyChannelMessageEditImpl(targetId, loadMessages, syncCtx)
}

/**
 * @param {string} targetId 目标消息 eventId
 * @returns {Promise<void>}
 */
export async function applyChannelMessageDelete(targetId) {
	return applyChannelMessageDeleteImpl(targetId, loadMessages, syncCtx)
}

/**
 * @param {string} eventId 目标消息 eventId
 * @returns {Promise<void>}
 */
export async function scrollToMessageEventId(eventId) {
	return scrollToMessageEventIdImpl(eventId, loadMessages, syncCtx)
}

/** @returns {Promise<void>} */
export async function submitComposer() {
	const input = document.getElementById('hub-message-input')
	if (input.disabled) return
	await stopVoiceIfRecording()
	const content = input.value.trim()
	const { selectedFiles } = await import('../composerFiles.mjs')
	if (!content && !selectedFiles.length) return
	if (!hubStore.context.currentGroupId || !hubStore.context.currentChannelId) return
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

watchHubState('messages.focusedMessageEventId', eventId => {
	if (!eventId) return
	void scrollToMessageEventId(String(eventId)).finally(() => setHubState('messages.focusedMessageEventId', null))
})

/** @param {string | null} eventId @returns {void} */
export function focusMessageEventId(eventId) {
	setHubState('messages.focusedMessageEventId', eventId ? String(eventId).trim() : null)
}

/**
 *
 */
export {
	bindReactions,
	getMessagesContainer,
	messageRenderOpts,
	refreshChannelMessagesIncremental,
	refreshReactionPerms,
	retryFailedPendingMessage,
	scrollToBottom,
	sendCurrentMessage,
	syncChannelActionsContext,
}
