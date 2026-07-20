/** @type {import('../../../../../../../../../decl/charAPI.ts').CharAPI_t} */
export default {
	info: {
		'zh-CN': {
			name: 'Plain Reply B',
			avatar: '🔵',
			description: 'no OnMessage; GetReply only',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
	},
	interfaces: {
		chat: {
			/**
			 * @returns {Promise<object>} 占位回复
			 */
			GetReply: async () => ({ content: 'plain_reply_b reply' }),
		},
	},
}
