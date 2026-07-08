/**
 * M2：最小无 AI 角色，供 greeting / char 写路径测试。
 * @type {import('../../../../../../../../../decl/charAPI.ts').CharAPI_t}
 */
export default {
	info: {
		'zh-CN': {
			name: '写路径 Agent',
			avatar: '🤖',
			description: 'write path fixture char',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
		'en-US': {
			name: 'Write-path Agent',
			avatar: '🤖',
			description: 'write path fixture char',
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
			GetReply: async () => ({ content: 'write_path_agent reply' }),
		},
	},
}
