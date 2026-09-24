/**
 * code shell 集成测试：GetReply 抛出普通对象（模拟 AI 源把 HTTP 错误包成 `{ data, response }` 抛出）。
 * @type {import('../../../../../../../../src/decl/charAPI.ts').CharAPI_t}
 */
export default {
	info: {
		'zh-CN': {
			name: 'wsThrowChar',
			avatar: '',
			description: 'code shell 集成测试用角色',
			description_markdown: 'code shell 集成测试用角色（GetReply 抛出普通对象）。',
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
			 * 抛出普通对象，不是 Error。
			 * @returns {Promise<never>} 永不返回。
			 */
			GetReply: async () => {
				throw { data: { error: { message: 'Endpoint is unavailable.' } }, response: { status: 503 } }
			},
		},
	},
}
