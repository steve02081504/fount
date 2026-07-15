/**
 * 【文件】public/hub/stream/handlers/channelMessage.mjs
 * 【职责】WS `channel_message` / `read_marker` / `vote_closed`。
 */
import { hubStore } from '../../core/state.mjs'
import { maybeBumpInboxBadgeFromWire } from '../../inboxClient.mjs'
import {
	bumpChannelUnread,
	handleReadMarkerWire,
} from '../../unread.mjs'
import { handleVoteClosedWire } from '../../wiring/voteEvents.mjs'
import { streamCallbacks } from '../callbacks.mjs'
import {
	dispatchChannelIncrementalRefresh,
	hubChannelMatch,
} from '../channelRefresh.mjs'
import {
	finishVolatileStreamPreview,
	hasVolatileStream,
} from '../volatileSlots.mjs'

/**
 * WS 回显己方消息时标记 DOM 行为 delivered（双勾）。
 * @param {object | null | undefined} channelMessage WS channel_message 载荷
 * @returns {void}
 */
function markOwnMessageDelivered(channelMessage) {
	const eventId = String(channelMessage?.eventId || '').trim()
	if (!eventId) return
	const viewerKey = String(hubStore.context.currentState?.viewerMemberPubKeyHash || '').trim().toLowerCase()
	const senderKey = String(channelMessage?.sender || channelMessage?.authorPubKeyHash || '').trim().toLowerCase()
	if (!viewerKey || !senderKey || viewerKey !== senderKey) return
	const msgList = hubStore.messages.channelMessagesSource
	const row = msgList.find(m => String(m.eventId) === eventId)
	if (row && row.deliveryStatus !== 'delivered') {
		row.deliveryStatus = 'delivered'
		const container = document.getElementById('hub-messages')
		const domRow = container?.querySelector(`[data-message-id="${CSS.escape(eventId)}"]`)
		if (domRow instanceof HTMLElement) {
			domRow.dataset.deliveryStatus = 'delivered'
			const existing = domRow.querySelector('.hub-delivery-status')
			if (existing) {
				existing.textContent = '✓✓'
				existing.classList.add('hub-delivery-status--delivered')
				existing.classList.remove('hub-delivery-status--sent')
			}
		}
	}
}

/**
 * @param {object} wireMessage WS 载荷
 * @param {string} channelId 当前频道
 * @returns {boolean} 是否已处理
 */
export function handleChannelMessageWire(wireMessage, channelId) {
	if (wireMessage.type === 'vote_closed') {
		handleVoteClosedWire(wireMessage, channelId)
		return true
	}

	if (wireMessage.type === 'read_marker') {
		handleReadMarkerWire(wireMessage)
		return true
	}

	if (wireMessage.type !== 'channel_message') return false

	const incomingChannelId = wireMessage.channelId
	const channelMessage = wireMessage.message
	maybeBumpInboxBadgeFromWire(wireMessage)
	const { main, thread } = hubChannelMatch(incomingChannelId, channelId)
	if (!main && !thread) {
		if (hubStore.context.currentGroupId)
			bumpChannelUnread(hubStore.context.currentGroupId, incomingChannelId)
		return true
	}
	if (channelMessage?.type === 'message_edit') {
		const targetId = String(channelMessage.content?.targetId || '').trim()
		if (targetId) {
			if (hasVolatileStream(targetId))
				finishVolatileStreamPreview(targetId)
			void streamCallbacks.onMessageEdit(targetId)
		}
		return true
	}
	const content = channelMessage?.content
	if (content?.is_generating && channelMessage?.eventId) {
		dispatchChannelIncrementalRefresh(incomingChannelId, channelId, { immediate: true })
		return true
	}

	markOwnMessageDelivered(channelMessage)
	dispatchChannelIncrementalRefresh(incomingChannelId, channelId, { immediate: true })
	return true
}
