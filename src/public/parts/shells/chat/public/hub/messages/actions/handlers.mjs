/**
 * 【文件】public/hub/messages/actions/handlers.mjs
 * 【职责】频道消息操作点击委托：按 data-action 分发到各 action 模块。
 */
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import {
	findContextMessage,
	getChannelMessageActionsContext,
} from '../messageActionsState.mjs'

import { handleBookmark } from './bookmark.mjs'
import { handleRegen, handleTimeline } from './branch.mjs'
import { handleClipboardAction, handleCopyShareLink } from './clipboard.mjs'
import { handleDelete } from './delete.mjs'
import { handleEdit } from './edit.mjs'
import { handleFeedbackPrompt, handleFeedbackSubmitCancel } from './feedback.mjs'
import { handleForward } from './forward.mjs'
import { handlePin } from './pin.mjs'
import { handleReply } from './reply.mjs'
import { handleThread } from './thread.mjs'
import { handleTranslate } from './translate.mjs'

const ACTION_BTN_SELECTOR = '.hub-message-action[data-action]'

/**
 * 处理频道 DAG 消息的操作（停止、反馈、时间线、书签等）。
 * @param {HTMLElement} button 被点击按钮
 * @param {HTMLElement | null} row 消息行
 * @param {object} channelMessage 上下文消息
 * @param {object} actions 操作上下文
 * @returns {Promise<boolean>} 是否已处理
 */
async function handleChannelMessageClick(button, row, channelMessage, actions) {
	const { action } = button.dataset
	if (!action) return false

	if (action === 'feedback-submit' || action === 'feedback-cancel')
		return handleFeedbackSubmitCancel(button, actions)

	if (action === 'timeline')
		return handleTimeline(button, actions)

	if (action === 'regen')
		return handleRegen(button, actions)

	const { eventId } = button.dataset
	if (!eventId) return false
	const { groupId, channelId } = actions
	if (!groupId || !channelId) return false

	switch (action) {
		case 'bookmark':
			return handleBookmark(button, actions)
		case 'pin':
			return handlePin(button, actions)
		case 'edit':
			return handleEdit(button, actions)
		case 'edit-save':
		case 'edit-cancel':
			return true
		case 'feedback-up':
			return handleFeedbackPrompt(button, 'up')
		case 'feedback-down':
			return handleFeedbackPrompt(button, 'down')
		case 'reply':
			return handleReply(button, channelMessage)
		case 'thread':
			return handleThread(button, row, channelMessage, actions)
		case 'delete':
			return handleDelete(button, row, channelMessage, actions)
		case 'copy-share-link':
			return handleCopyShareLink(button, actions)
		case 'forward':
			return handleForward(button, channelMessage, actions)
		case 'translate':
			return handleTranslate(button, row, channelMessage)
		case 'copy-md':
		case 'copy-text':
		case 'copy-html':
		case 'download':
		case 'share':
			return handleClipboardAction(button, row, channelMessage, action)
		default:
			return false
	}
}

/**
 * 为消息列表绑定操作按钮委托（仅绑定一次）。
 * @param {HTMLElement} container `#hub-messages` 根节点
 * @returns {void}
 */
export function bindChannelMessageActions(container) {
	if (!(container instanceof HTMLElement)) return
	if (container.dataset.hubChannelActionsBound === '1') return
	container.dataset.hubChannelActionsBound = '1'
	container.addEventListener('click', async (clickEvent) => {
		const joinBtn = /** @type {HTMLElement} */ clickEvent.target.closest('.hub-call-join-btn')
		if (joinBtn) {
			clickEvent.stopPropagation()
			const { hubStore } = await import('../../core/state.mjs')
			const groupId = hubStore.context.currentGroupId
			const channelId = hubStore.context.currentChannelId
			if (groupId && channelId) {
				const { joinChannelCall } = await import('../../call.mjs')
				await joinChannelCall(groupId, channelId)
			}
			return
		}
		const actions = getChannelMessageActionsContext(clickEvent.target)
		if (!actions) return
		const retryButton = /** @type {HTMLElement} */ clickEvent.target.closest('[data-retry-send]')
		if (retryButton?.dataset.retrySend) {
			clickEvent.stopPropagation()
			const tempId = retryButton.dataset.retrySend
			try {
				const { retryFailedPendingMessage } = await import('../messages.mjs')
				await retryFailedPendingMessage(tempId)
			}
			catch (error) {
				showToastI18n('error', 'chat.hub.sendFailed', { error: error?.message || String(error) })
			}
			return
		}
		const button = /** @type {HTMLElement} */ clickEvent.target.closest(ACTION_BTN_SELECTOR)
		if (!button) return
		clickEvent.stopPropagation()

		const row = button.closest('.hub-message, .hub-char-entry')
		const channelMessage = findContextMessage(row, actions) || {}

		await handleChannelMessageClick(button, row, channelMessage, actions)
	})
}
