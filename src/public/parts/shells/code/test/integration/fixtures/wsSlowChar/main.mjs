/**
 * code shell 集成测试用可中断慢速角色：用户消息含 `slow` 时逐字符缓慢流式（便于生成中 attach/abort），
 * 否则立即返回固定回复。支持经 `generation_options.signal` 中断。
 * @type {import('../../../../../../../../src/decl/charAPI.ts').CharAPI_t}
 */
export default {
	info: {
		'zh-CN': {
			name: 'wsSlowChar',
			avatar: '',
			description: 'code shell 集成测试用可中断慢速角色',
			description_markdown: 'code shell 集成测试用可中断慢速角色（慢速流式 + 可中断）。',
			version: '0.0.0',
			author: 'fount test',
			home_page: '',
			tags: ['test'],
		},
	},
	/**
	 * 初始化。
	 * @returns {void}
	 */
	Init: () => { },
	/**
	 * 安装/卸载钩子。
	 * @returns {void}
	 */
	Uninstall: () => { },
	/**
	 * 加载钩子。
	 * @returns {void}
	 */
	Load: () => { },
	/**
	 * 卸载钩子。
	 * @returns {void}
	 */
	Unload: () => { },
	interfaces: {
		chat: {
			/**
			 * 获取开场白。
			 * @returns {{content: string}} 开场白。
			 */
			GetGreeting: () => ({ content: '你好。' }),
			/**
			 * 获取群组问好。
			 * @returns {{content: string}} 问好。
			 */
			GetGroupGreeting: () => ({ content: '大家好。' }),
			/**
			 * 获取提示词。
			 * @returns {Promise<object>} 空提示结构。
			 */
			GetPrompt: async () => ({ text: [], additional_chat_log: [], extension: {} }),
			/**
			 * 获取其他角色看到的设定。
			 * @returns {object} 空提示结构。
			 */
			GetPromptForOther: () => ({ text: [], additional_chat_log: [], extension: {} }),
			/**
			 * 生成回复：用户消息含 `slow` 时按 100ms/字符慢速流式并可中断，否则立即返回。
			 * @param {object} args - 聊天回复请求。
			 * @returns {Promise<object>} 回复对象。
			 */
			GetReply: async args => {
				args.generation_options ??= {}
				const signal = args.generation_options.signal
				/** @type {object} */
				const result = { content: '', logContextBefore: [], logContextAfter: [], files: [], extension: {} }
				args.generation_options.base_result = result
				const slow = args.chat_log?.some(entry => entry.role === 'user' && String(entry.content ?? '').includes('slow'))
				const text = slow ? 'slow-'.repeat(12) : 'fast-reply'
				for (const ch of Array.from(text)) {
					if (slow) await new Promise(resolve => setTimeout(resolve, 100))
					signal?.throwIfAborted?.()
					result.content += ch
					args.generation_options.replyPreviewUpdater?.({ ...result })
				}
				return result
			},
		},
	},
}
