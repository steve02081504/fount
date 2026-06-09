import {
	appendChannelMessageDelete,
	appendChannelMessageEdit,
	appendChannelMessageFeedback,
} from '../../chat/channel/messageMutations.mjs'
import { postChannelMessage } from '../../chat/channel/postMessage.mjs'
import { appendReactionEvent } from '../../chat/dag/channelOps.mjs'

/**
 * 频道消息写操作（路由层薄封装）。
 */
export const ChannelMessageService = {
	postMessage: postChannelMessage,
	deleteMessage: appendChannelMessageDelete,
	editMessage: appendChannelMessageEdit,
	setFeedback: appendChannelMessageFeedback,
	addReaction: appendReactionEvent,
}
