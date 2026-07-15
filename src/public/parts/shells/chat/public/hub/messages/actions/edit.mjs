/**
 * 【文件】public/hub/messages/actions/edit.mjs
 * 【职责】频道消息内联编辑。
 */
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { editChannelMessage } from '../../../src/api/groupChannel.mjs'
import { findContextMessage } from '../messageActionsState.mjs'
import {
	appendEditArea,
	bindMessageEditArea,
	editChannelBodyHtml,
	removeWithFade,
} from '../messageActionsUi.mjs'
import { getMessageEditText } from '../render/text.mjs'

/**
 * @param {HTMLElement} button 被点击按钮
 * @param {object} actions 操作上下文
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handleEdit(button, actions) {
	const { groupId, channelId, reload } = actions
	const eventId = button.dataset.eventId
	if (!eventId || !groupId || !channelId) return false
	const messageRow = button.closest('.hub-message')
	if (messageRow?.querySelector('.hub-message-edit-area')) return true
	const contextMessage = findContextMessage(messageRow, actions) || {}
	const originalText = String(
		contextMessage.content_for_edit
		?? getMessageEditText(contextMessage)
		?? messageRow?.querySelector('.hub-message-content')?.textContent
		?? '',
	)
	const initialFiles = Array.isArray(contextMessage.files)
		? contextMessage.files
		: Array.isArray(contextMessage.content?.files)
			? contextMessage.content.files
			: []
	const editWrap = await appendEditArea(messageRow, await editChannelBodyHtml(originalText, eventId))
	let charEditor = null
	/** @returns {Promise<void>} */
	const saveCharEdit = async () => {
		if (!charEditor) return
		const saveButton = editWrap?.querySelector('.hub-message-edit-save')
		if (saveButton instanceof HTMLButtonElement) saveButton.disabled = true
		try {
			await editChannelMessage(groupId, channelId, eventId, charEditor.getText())
			await removeWithFade(editWrap)
			await reload?.()
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.messageActionFailed', { error: error?.message || String(error) })
		}
		finally {
			if (saveButton instanceof HTMLButtonElement) saveButton.disabled = false
		}
	}
	charEditor = bindMessageEditArea(editWrap, {
		initialFiles,
		/** @returns {void} */
		onCancel: () => removeWithFade(editWrap),
		onSave: saveCharEdit,
	})
	const textarea = editWrap?.querySelector('textarea')
	if (textarea instanceof HTMLTextAreaElement) {
		textarea.focus()
		textarea.setSelectionRange(textarea.value.length, textarea.value.length)
	}
	return true
}
