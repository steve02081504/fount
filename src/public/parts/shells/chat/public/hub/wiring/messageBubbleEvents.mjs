import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { confirmI18n } from '../../../../../scripts/i18n/index.mjs'
import { saveCustomEmojiFromRef } from '../../src/customEmojis.mjs'
import { saveStickerFromMessage } from '../../src/saveStickerFromMessage.mjs'
import { showTrustAuthorDialog } from '../../src/trustAuthorDialog.mjs'
import { handleUIError } from '../../src/ui/errors.mjs'
import { hubStore } from '../core/state.mjs'

/**
 * @param {Event} event 点击事件
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handleMessageBubbleClick(event) {
	const trustAuthorButton = event.target.closest('.hub-trust-author-button')
	if (trustAuthorButton?.dataset?.authorPubKeyHash) {
		const authorDisplayName = trustAuthorButton.closest('.hub-message')
			?.querySelector('.hub-message-author')?.textContent
		const trusted = await showTrustAuthorDialog(
			trustAuthorButton.dataset.authorPubKeyHash,
			authorDisplayName,
		)
		if (trusted) {
			showToastI18n('success', 'chat.hub.trustOk')
			const messageRow = trustAuthorButton.closest('.hub-message[data-message-id]')
			const messageId = messageRow?.getAttribute('data-message-id')
			const container = document.getElementById('hub-messages')
			if (messageId) {
				const { hydrateMessageMarkdown } = await import('../messages/render/markdown.mjs')
				await hydrateMessageMarkdown(container, messageId)
			}
		}
		return true
	}
	const saveEmojiButton = event.target.closest('.hub-save-emoji-button')
	if (saveEmojiButton?.dataset?.emojiGroup && saveEmojiButton?.dataset?.emojiId) {
		await saveCustomEmojiFromRef(saveEmojiButton.dataset.emojiGroup, saveEmojiButton.dataset.emojiId)
		showToastI18n('success', 'chat.hub.saveEmojiOk')
		return true
	}
	const saveStickerButton = event.target.closest('.hub-save-sticker-button')
	if (saveStickerButton) {
		const messageRow = saveStickerButton.closest('.hub-message[data-message-id]')
		const messageId = messageRow?.getAttribute('data-message-id')
		const channelMessage = hubStore.messages.channelMessages.find(entry => String(entry.eventId) === messageId)
		if (!channelMessage?.content) return true
		try {
			await saveStickerFromMessage(channelMessage.content)
			showToastI18n('success', 'chat.hub.saveStickerOk')
		}
		catch (error) {
			handleUIError(error, 'chat.hub.saveStickerFailed')
		}
		return true
	}
	const blockAuthorButton = event.target.closest('.hub-block-author-button')
	if (blockAuthorButton?.dataset?.blockPub && hubStore.context.currentGroupId) {
		if (!confirmI18n('chat.hub.blockConfirm')) return true
		const response = await fetch('/api/p2p/denylist', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({
				scope: 'subject',
				value: blockAuthorButton.dataset.blockPub,
				groupId: hubStore.context.currentGroupId,
			}),
		})
		if (!response.ok) {
			const data = await response.json().catch(() => ({}))
			handleUIError(new Error(data.error || response.statusText), 'chat.hub.operationFailed')
			return true
		}
		showToastI18n('success', 'chat.hub.blockOk')
		return true
	}
	return false
}
