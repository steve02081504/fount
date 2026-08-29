import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { confirmI18n } from '../../../../../scripts/i18n/index.mjs'
import { parseEmojiToken } from '../../shared/inlineTokenSyntax.mjs'
import { addDenylistEntry } from '../../src/endpoints/p2p.mjs'
import { addPackToCollection, saveStickerFromMessage } from '../../src/saveStickerFromMessage.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { store } from '../core/state.mjs'

/**
 * @param {Event} event 点击事件
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handleMessageBubbleClick(event) {
	const saveEmojiButton = event.target.closest('.save-emoji-button')
	if (saveEmojiButton?.dataset?.emojiPack) {
		try {
			await addPackToCollection(saveEmojiButton.dataset.emojiPack)
			showToastI18n('success', 'chat.hub.save.emojiOk')
		}
		catch (error) {
			handleError('chat.hub.save.emojiFailed')(error)
		}
		return true
	}
	const saveStickerButton = event.target.closest('.save-sticker-button')
	if (saveStickerButton) {
		const messageRow = saveStickerButton.closest('.message[data-message-id]')
		const messageId = messageRow?.getAttribute('data-message-id')
		const channelMessage = store.messages.channelMessages.find(entry => String(entry.eventId) === messageId)
		if (!channelMessage?.content) return true
		if (!parseEmojiToken(channelMessage.content.emoji)?.packId) return true
		try {
			await saveStickerFromMessage(channelMessage.content)
			showToastI18n('success', 'chat.hub.save.stickerOk')
		}
		catch (error) {
			handleError('chat.hub.save.stickerFailed')(error)
		}
		return true
	}
	const blockAuthorButton = event.target.closest('.block-author-button')
	if (blockAuthorButton?.dataset?.blockPub && store.context.currentGroupId) {
		if (!confirmI18n('chat.hub.block.confirm')) return true
		try {
			await addDenylistEntry({
				scope: 'subject',
				value: blockAuthorButton.dataset.blockPub,
				groupId: store.context.currentGroupId,
			})
			showToastI18n('success', 'chat.hub.block.ok')
		}
		catch (error) {
			handleError('chat.hub.operationFailed')(error)
		}
		return true
	}
	return false
}
