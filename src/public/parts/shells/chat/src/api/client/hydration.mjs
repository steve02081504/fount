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
			const { isVirtualBridgeGroupId } = await import('../../chat/bridge/session.mjs')
			if (isVirtualBridgeGroupId(groupId)) {
				const { createVirtualBridgeMessage } = await import('../../chat/bridge/virtualObjects.mjs')
				return createVirtualBridgeMessage(apiContext, groupId, {
					...message,
					channelId: event.channel?.channelId || message.channelId || 'default',
					eventId: message.eventId || message.id || message.extension?.virtualEventId,
				}, event.mentions)
			}
			return createMessage(apiContext, groupId, {
				...message,
				channelId: event.channel?.channelId || message.channelId || 'default',
				eventId: message.eventId || message.id || message.extension?.chat?.eventId || message.extension?.virtualEventId,
			}, event.mentions)
		},
	}
}
