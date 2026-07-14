/** @type {import('../../../../../../../../../decl/charAPI.ts').CharAPI_t} */
export default {
	info: {
		'zh-CN': {
			name: 'OnMessage No',
			avatar: '🔴',
			description: 'OnMessage always false',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
	},
	interfaces: {
		chat: {
			/**
			 * @returns {Promise<{ content: string }>} 回复对象
			 */
			GetReply: async () => ({ content: 'on_message_no reply' }),
			/**
			 * @param {object} event 事件
			 * @returns {Promise<boolean>} 恒为 false
			 */
			OnMessage: async event => {
				const state = globalThis.__fountOnMessageProbe || { events: [], returnValue: false }
				state.events.push({
					message: event.message,
					mentions: event.mentions,
					group: event.group,
					channel: event.channel,
				})
				return false
			},
		},
	},
}
