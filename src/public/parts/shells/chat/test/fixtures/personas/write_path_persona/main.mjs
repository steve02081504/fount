import { writePathHookState } from 'fount/public/parts/shells/chat/test/fixtures/probes/writePathHookState.mjs'

/**
 * BeforeUserSend 改写 / 拒绝。
 * @type {import('../../../../../../../../../decl/userAPI.ts').UserAPI_t}
 */
export default {
	info: {
		'zh-CN': {
			name: '写路径测试人格',
			avatar: '🧑',
			description: 'BeforeUserSend fixture',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
		'en-US': {
			name: 'Write-path test persona',
			avatar: '🧑',
			description: 'BeforeUserSend fixture',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
	},
	interfaces: {
		chat: {
			/**
			 * @returns {Promise<object>} prompt
			 */
			GetPrompt: async () => ({
				text: [{ content: 'write_path persona', important: 0 }],
				additional_chat_log: [],
				extension: {},
			}),
			/**
			 * @param {object} context BeforeUserSend 上下文
			 * @returns {Promise<object | undefined>} 改写/拒绝
			 */
			BeforeUserSend: async context => {
				writePathHookState.beforeSendCalls.push({
					channelId: context.channelId,
					text: context.input?.content,
				})
				const text = String(context.input?.content || '')
				if (text.includes('persona-reject-me'))
					return { reject: 'persona rejected send' }
				if (text.includes('persona-rewrite-me'))
					return {
						input: {
							...context.input,
							type: 'text',
							content: text.replace('persona-rewrite-me', 'persona-rewritten'),
						},
					}
			},
		},
	},
}
