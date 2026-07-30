import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { confirmI18n } from '../../../../../scripts/i18n/index.mjs'
import { parseEmojiToken } from '../../shared/inlineTokenSyntax.mjs'
import { addPackToCollection, saveStickerFromMessage } from '../../src/saveStickerFromMessage.mjs'
import { showTrustAuthorDialog } from '../../src/trustAuthorDialog.mjs'
import { handleUIError } from '../../src/ui/errors.mjs'
import { store } from '../core/state.mjs'

/**
 * @param {Event} event 点击事件
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handleMessageBubbleClick(event) {
	const trustAuthorButton = event.target.closest('.trust-author-button')
	if (trustAuthorButton?.dataset?.authorPubKeyHash) {
		const authorDisplayName = trustAuthorButton.closest('.message')
			?.querySelector('.message-author')?.textContent
		const trusted = await showTrustAuthorDialog(
			trustAuthorButton.dataset.authorPubKeyHash,
			authorDisplayName,
		)
		if (trusted) {
			showToastI18n('success', 'chat.hub.trustOk')
			const messageRow = trustAuthorButton.closest('.message[data-message-id]')
			const messageId = messageRow?.getAttribute('data-message-id')
			const container = document.getElementById('messages')
			if (messageId) {
				const { hydrateMessageMarkdown } = await import('../messages/render/markdown.mjs')
				await hydrateMessageMarkdown(container, messageId)
			}
		}
		return true
	}
	const saveEmojiButton = event.target.closest('.save-emoji-button')
	if (saveEmojiButton?.dataset?.emojiPack) {
		try {
			await addPackToCollection(saveEmojiButton.dataset.emojiPack)
			showToastI18n('success', 'chat.hub.save.emojiOk')
		}
		catch (error) {
			handleUIError(error, 'chat.hub.save.emojiFailed')
		}
		return true
	}
	const saveStickerButton = event.target.closest('.save-sticker-button')
	if (saveStickerButton) {
		const messageRow = saveStickerButton.closest('.message[data-message-id]')
		const messageId = messageRow?.getAttribute('data-message-id')
		const channelMessage = store.messages.channelMessages.find(entry => String(entry.eventId) === messageId)
		if (!channelMessage?.content) return true
		if (!parseEmojiToken(channelMessage.content.emojiRef)?.packId) return true
		try {
			await saveStickerFromMessage(channelMessage.content)
			showToastI18n('success', 'chat.hub.save.stickerOk')
		}
		catch (error) {
			handleUIError(error, 'chat.hub.save.stickerFailed')
		}
		return true
	}
	const blockAuthorButton = event.target.closest('.block-author-button')
	if (blockAuthorButton?.dataset?.blockPub && store.context.currentGroupId) {
		if (!confirmI18n('chat.hub.block.confirm')) return true
		try {
			const response = await fetch('/api/p2p/denylist', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					scope: 'subject',
					value: blockAuthorButton.dataset.blockPub,
					groupId: store.context.currentGroupId,
				}),
			})
			if (!response.ok) {
				const data = await response.json().catch(() => ({}))
				handleUIError(new Error(data.error || response.statusText), 'chat.hub.operationFailed')
				return true
			}
			showToastI18n('success', 'chat.hub.block.ok')
		}
		catch (error) {
			handleUIError(error, 'chat.hub.operationFailed')
		}
		return true
	}
	return false
}
