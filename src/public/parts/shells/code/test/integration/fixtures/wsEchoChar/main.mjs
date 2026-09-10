/**
 * code shell 集成测试：立即返回固定回复的测试角色（不依赖 AI 源）。
 * @type {import('../../../../../../../../src/decl/charAPI.ts').CharAPI_t}
 */
export default {
	info: {
		'zh-CN': {
			name: 'wsEchoChar',
			avatar: '',
			description: 'code shell 集成测试用角色',
			description_markdown: 'code shell 集成测试用角色（立即返回固定回复）。',
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
			 * 立即返回固定回复（测试不依赖 AI 源）。
			 * @returns {Promise<object>} 回复对象。
			 */
			GetReply: async () => ({ content: 'echo-reply', logContextBefore: [], logContextAfter: [], files: [], extension: {} }),
		},
	},
}
