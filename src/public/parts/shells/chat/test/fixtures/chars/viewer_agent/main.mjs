/**
 * 最小无 AI 角色，仅供 getChatRequest agent 路径集成测试。
 * @type {import('../../../../../../../../../decl/charAPI.ts').CharAPI_t}
 */
export default {
	info: {
		'zh-CN': {
			name: 'Viewer Agent',
			avatar: '🤖',
			description: 'viewer chatlog parity fixture',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
		'en-US': {
			name: 'Viewer Agent',
			avatar: '🤖',
			description: 'viewer chatlog parity fixture',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
	},
	interfaces: {
		chat: {
			/** @returns {Promise<object>} 占位回复 */
			GetReply: async () => ({ content: 'viewer_agent noop' }),
		},
	},
}
