/**
 * 【文件】public/hub/messages/actions/bookmark.mjs
 * 【职责】频道消息书签。
 */
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { addChatBookmark } from '../../../src/endpoints/groupBookmarks.mjs'
import { refreshPinsBookmarks } from '../../pinsBookmarks.mjs'
import { getMessageText } from '../render/text.mjs'

/**
 * @param {HTMLElement} button 被点击按钮
 * @param {object} actions 操作上下文
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handleBookmark(button, actions) {
	const { groupId, channelId } = actions
	const { eventId } = button.dataset
	if (!eventId || !groupId || !channelId) return false
	button.disabled = true
	try {
		const rowMessageId = button.closest('.message')?.getAttribute('data-message-id')
		const bookmarkedMessage = actions.messages?.find(message => String(message.eventId) === rowMessageId)
		const preview = bookmarkedMessage ? getMessageText(bookmarkedMessage).slice(0, 40) : eventId.slice(0, 12)
		await addChatBookmark({
			groupId,
			channelId,
			eventId,
			title: preview || eventId.slice(0, 12),
			href: `#group:${groupId}:${channelId}`,
		})
		void refreshPinsBookmarks()
	}
	catch (error) {
		showToastI18n('error', 'chat.hub.message.action.failed', { error: error?.message || String(error) })
	}
	finally { button.disabled = false }
	return true
}
