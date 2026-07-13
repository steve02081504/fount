/** @type {import('../../../../../../../../../decl/charAPI.ts').CharAPI_t} */
export default {
	info: {
		'zh-CN': {
			name: 'onMessage Yes',
			avatar: '🟢',
			description: 'onMessage probe',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
	},
	interfaces: {
		chat: {
			/** @returns {Promise<{ content: string }>} 固定回复并累加 probe 计数 */
			GetReply: async () => {
				const state = globalThis.__fountOnMessageProbe || { events: [], replies: 0, returnValue: true }
				state.replies = (state.replies || 0) + 1
				return { content: 'on_message_yes reply' }
			},
			/**
			 * @param {object} event onMessage 事件
			 * @returns {Promise<boolean>} probe 配置的回复意愿
			 */
			onMessage: async event => {
				const state = globalThis.__fountOnMessageProbe || { events: [], replies: 0, returnValue: true }
				state.events.push({
					message: event.message,
					mentions: event.mentions,
					group: event.group,
					channel: event.channel,
				})
				return !!state.returnValue
			},
			/**
			 * @param {object} event 群事件
			 * @returns {Promise<void>}
			 */
			onGroupEvent: async event => {
				(globalThis.__fountGroupEventProbe ??= []).push(event)
			},
		},
	},
}
