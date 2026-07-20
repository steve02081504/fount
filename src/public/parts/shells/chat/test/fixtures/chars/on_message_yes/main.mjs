import { groupEventProbe } from 'fount/public/parts/shells/chat/test/fixtures/probes/groupEventProbe.mjs'
import { onMessageProbe } from 'fount/public/parts/shells/chat/test/fixtures/probes/onMessageProbe.mjs'

/** @type {import('../../../../../../../../../decl/charAPI.ts').CharAPI_t} */
export default {
	info: {
		'zh-CN': {
			name: 'OnMessage Yes',
			avatar: '🟢',
			description: 'OnMessage probe',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
	},
	interfaces: {
		chat: {
			/** @returns {Promise<{ content: string }>} 固定回复并累加 probe 计数 */
			GetReply: async () => {
				onMessageProbe.replies++
				return { content: 'on_message_yes reply' }
			},
			/**
			 * @param {object} event OnMessage 事件
			 * @returns {Promise<boolean>} probe 配置的回复意愿
			 */
			OnMessage: async event => {
				onMessageProbe.events.push({
					message: event.message,
					mentions: event.mentions,
					group: event.group,
					channel: event.channel,
				})
				return !!onMessageProbe.returnValue
			},
			/**
			 * @param {object} event 群事件
			 * @returns {Promise<void>}
			 */
			OnGroupEvent: async event => {
				groupEventProbe.events.push(event)
			},
		},
	},
}
