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
import {
	dispatchChannelIncrementalRefresh,
	dispatchChannelMessageEdit,
	hubChannelMatch,
} from '../channelRefresh.mjs'
import {
	finishVolatileStreamPreview,
	hasVolatileStream,
} from '../volatileSlots.mjs'

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
			void dispatchChannelMessageEdit(targetId, channelMessage.content || null)
		}
		return true
	}
	const content = channelMessage?.content
	if (content?.is_generating && channelMessage?.eventId) {
		dispatchChannelIncrementalRefresh(incomingChannelId, channelId, { immediate: true })
		return true
	}

	dispatchChannelIncrementalRefresh(incomingChannelId, channelId, { immediate: true })
	return true
}
