import { createMessage } from '../message.mjs'

/**
 * @param {import('../internal.mjs').ChatApiContext} apiContext API 上下文
 * @returns {object} 消息水合方法
 */
export function createHydrationMethods(apiContext) {
	return {
		/**
		 * @param {object} event OnMessage 纯数据事件
		 * @returns {Promise<object>} Message
		 */
		async messageFrom(event) {
			const groupId = event.group?.groupId
			const message = event.message || event
			return createMessage(apiContext, groupId, {
				...message,
				channelId: event.channel?.channelId || message.channelId || 'default',
				eventId: message.eventId || message.id || message.extension?.dagEventId,
			}, event.mentions)
		},
	}
}
