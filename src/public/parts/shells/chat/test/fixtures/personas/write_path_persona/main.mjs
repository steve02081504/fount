/**
 * M2：BeforeUserSend 改写 / 拒绝。
 * @type {import('../../../../../../../../../decl/userAPI.ts').UserAPI_t}
 */
const HOOK_KEY = '__fount_write_path_hook_state__'

/**
 * @returns {{ addCalls: object[], afterCalls: object[], beforeSendCalls: object[] }} 计数器
 */
function hookState() {
	if (!globalThis[HOOK_KEY])
		globalThis[HOOK_KEY] = { addCalls: [], afterCalls: [], beforeSendCalls: [] }
	return globalThis[HOOK_KEY]
}

/**
 *
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
			 * @param {object} ctx BeforeUserSend 上下文
			 * @returns {Promise<object | undefined>} 改写/拒绝
			 */
			BeforeUserSend: async ctx => {
				hookState().beforeSendCalls.push({
					channelId: ctx.channelId,
					text: ctx.input?.content,
				})
				const text = String(ctx.input?.content || '')
				if (text.includes('persona-reject-me'))
					return { reject: 'persona rejected send' }
				if (text.includes('persona-rewrite-me'))
					return {
						input: {
							...ctx.input,
							type: 'text',
							content: text.replace('persona-rewrite-me', 'persona-rewritten'),
						},
					}
			},
		},
	},
}
