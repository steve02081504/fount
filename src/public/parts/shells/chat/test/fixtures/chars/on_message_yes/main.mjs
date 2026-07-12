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
			GetReply: async () => ({ content: 'on_message_yes reply' }),
			onMessage: async event => {
				const state = globalThis.__fountOnMessageProbe || { events: [], returnValue: true }
				state.events.push({
					message: event.message,
					mentions: event.mentions,
					group: event.group,
					channel: event.channel,
				})
				return !!state.returnValue
			},
		},
	},
}
