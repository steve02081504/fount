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
			GetReply: async () => ({ content: 'on_message_no reply' }),
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
