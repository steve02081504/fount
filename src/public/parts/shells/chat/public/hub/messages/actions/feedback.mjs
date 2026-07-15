/**
 * 【文件】public/hub/messages/actions/feedback.mjs
 * 【职责】消息反馈（赞/踩）及原因提交。
 */
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { setChannelMessageFeedback } from '../../../src/api/groupChannel.mjs'
import {
	activeFeedbackEdits,
	showFeedbackReasonInput,
} from '../messageActionsState.mjs'
import { removeWithFade } from '../messageActionsUi.mjs'

/**
 * @param {HTMLElement} button 被点击按钮
 * @param {object} actions 操作上下文
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handleFeedbackSubmitCancel(button, actions) {
	const { groupId, channelId, reload } = actions
	const { action } = button.dataset
	const area = button.closest('.hub-message-feedback-reason-area')
	const eventId = button.dataset.eventId || area?.dataset.eventId
	if (!eventId || !area) return true
	if (action === 'feedback-cancel') {
		activeFeedbackEdits.delete(eventId)
		void removeWithFade(area)
		return true
	}
	const type = area.dataset.feedbackType === 'down' ? 'down' : 'up'
	const reason = area.querySelector('textarea')?.value?.trim() || ''
	button.disabled = true
	try {
		await setChannelMessageFeedback(groupId, channelId, eventId, type, reason)
		activeFeedbackEdits.delete(eventId)
		await removeWithFade(area)
		await reload?.()
	}
	catch (error) {
		showToastI18n('error', 'chat.hub.messageActionFailed', { error: error?.message || String(error) })
	}
	finally { button.disabled = false }
	return true
}

/**
 * @param {HTMLElement} button 被点击按钮
 * @param {'up'|'down'} type 反馈方向
 * @returns {boolean} 是否已处理
 */
export function handleFeedbackPrompt(button, type) {
	const messageRow = /** @type {HTMLElement | null} */ button.closest('.hub-message, .hub-char-entry')
	const eventId = button.dataset.eventId
	if (!eventId) return false
	void showFeedbackReasonInput(messageRow, eventId, type)
	return true
}
