/** @type {import('../../../../../../../../../decl/charAPI.ts').CharAPI_t} */
export default {
	info: {
		'zh-CN': {
			name: 'Slow Reply',
			avatar: '🐢',
			description: 'slow GetReply honoring generation abort signal',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
	},
	interfaces: {
		chat: {
			/**
			 * @param {object} request 聊天请求
			 * @returns {Promise<object>} 延迟回复
			 */
			GetReply: async request => {
				const signal = request?.generation_options?.signal
				const deadline = Date.now() + 2000
				while (Date.now() < deadline) {
					if (signal?.aborted) {
						const error = new Error('User Aborted')
						error.name = 'AbortError'
						throw error
					}
					await new Promise(resolve => setTimeout(resolve, 20))
				}
				return { content: 'slow_reply done' }
			},
		},
	},
}
