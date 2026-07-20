/**
 * 【文件】public/hub/messages/actions/reply.mjs
 * 【职责】内联 quote-reply：把目标消息填入 composer 引用状态。
 */
import { setReplyTarget } from '../../composerReply.mjs'
import { authorPresentationKeys } from '../../core/domUtils.mjs'
import { getMessageText } from '../render/text.mjs'

/**
 * @param {HTMLElement} button 被点击按钮
 * @param {object} channelMessage 上下文消息
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handleReply(button, channelMessage) {
	const eventId = String(button.dataset.eventId || channelMessage?.eventId || '').trim().toLowerCase()
	if (!/^[0-9a-f]{64}$/.test(eventId)) return true
	const { displayName } = authorPresentationKeys(
		channelMessage?.charId ?? channelMessage?.authorPubKeyHash ?? channelMessage?.sender ?? '?',
	)
	const preview = getMessageText(channelMessage).replace(/\s+/g, ' ').trim().slice(0, 120)
		|| String(channelMessage?.content?.displayName || '').trim()
		|| '…'
	setReplyTarget({
		eventId,
		senderName: channelMessage?.content?.displayName || displayName,
		preview,
	})
	return true
}
