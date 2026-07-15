/**
 * 【文件】public/hub/messages/actions/delete.mjs
 * 【职责】频道消息删除。
 */
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { confirmI18n } from '../../../../../../scripts/i18n/index.mjs'
import { deleteChannelMessage } from '../../../src/api/groupChannel.mjs'
import { enqueueDeletion } from '../messageActionsState.mjs'
import { shouldConfirmDelete } from '../messageActionsUi.mjs'
import { getMessageText } from '../render/text.mjs'

/**
 * @param {HTMLElement} button 被点击按钮
 * @param {HTMLElement | null} row 消息行
 * @param {object} channelMessage 上下文消息
 * @param {object} actions 操作上下文
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handleDelete(button, row, channelMessage, actions) {
	const { groupId, channelId, reload } = actions
	const eventId = button.dataset.eventId
	if (!eventId || !groupId || !channelId) return false
	const text = getMessageText(channelMessage)
		|| row?.querySelector('.hub-message-content')?.textContent?.trim()
		|| ''
	if (shouldConfirmDelete(text) && !confirmI18n('chat.hub.confirmDeleteLong'))
		return true
	button.disabled = true
	enqueueDeletion(async () => {
		try {
			await deleteChannelMessage(groupId, channelId, eventId)
			await reload?.()
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.messageActionFailed', { error: error?.message || String(error) })
			button.disabled = false
		}
	})
	return true
}
