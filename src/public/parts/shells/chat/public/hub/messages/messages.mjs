/**
 * 【文件】public/hub/messages/messages.mjs
 * 【职责】频道消息薄聚合：重导出子模块并绑定 Hub 状态订阅。
 */
import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { stopVoiceIfRecording } from '../composerFiles.mjs'
import { store, setState, watchState } from '../core/state.mjs'

import { bindReactions, messageRenderOpts, refreshReactionPerms, syncChannelActionsContext } from './messageContext.mjs'
import {
	applyChannelMessageDelete,
	applyChannelMessageEdit,
	loadMessages,
	refreshChannelMessagesIncremental,
	refreshChannelViewDom,
	scheduleChannelIncrementalRefresh,
} from './messageRefresh.mjs'
import { getMessagesContainer, scrollToBottom, scrollToMessageEventId } from './messageScroll.mjs'
import { retryFailedPendingMessage, sendCurrentMessage } from './messageSend.mjs'

/** @returns {Promise<void>} */
export async function submitComposer() {
	const input = document.getElementById('message-input')
	if (input.disabled) return
	await stopVoiceIfRecording()
	const content = input.value.trim()
	const { selectedFiles } = await import('../composerFiles.mjs')
	if (!content && !selectedFiles.length) return
	if (!store.context.currentGroupId || !store.context.currentChannelId) return
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

watchState('messages.focusedMessageEventId', eventId => {
	if (!eventId) return
	void scrollToMessageEventId(String(eventId)).finally(() => setState('messages.focusedMessageEventId', null))
})

/** @param {string | null} eventId @returns {void} */
export function focusMessageEventId(eventId) {
	setState('messages.focusedMessageEventId', eventId ? String(eventId).trim() : null)
}

/**
 *
 */
export {
	applyChannelMessageDelete,
	applyChannelMessageEdit,
	bindReactions,
	getMessagesContainer,
	loadMessages,
	messageRenderOpts,
	refreshChannelMessagesIncremental,
	refreshChannelViewDom,
	refreshReactionPerms,
	retryFailedPendingMessage,
	scheduleChannelIncrementalRefresh,
	scrollToBottom,
	scrollToMessageEventId,
	sendCurrentMessage,
	syncChannelActionsContext,
}
