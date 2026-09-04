/**
 * 角色 API 类型别名。
 * @typedef {import('../../../../../../../src/decl/charAPI.ts').CharAPI_t} CharAPI_t
 */
/**
 * code shell 前端测试用角色：第二个角色，用于验证角色切换。
 * @type {CharAPI_t}
 */
export default {
	info: {
		'zh-CN': {
			name: 'testAgent',
			avatar: '',
			description: 'code shell 前端测试用测试代理角色',
			description_markdown: 'code shell 前端测试用测试代理角色。',
			version: '0.0.0',
			author: 'fount test',
			home_page: '',
			tags: ['test'],
		},
	},
	/**
	 * 初始化函数。
	 * @param {object} stat - 部件状态对象。
	 * @returns {void}
	 */
	Init: stat => { },
	/**
	 * 卸载函数。
	 * @param {string} reason - 卸载原因。
	 * @param {string} from - 来源。
	 * @returns {void}
	 */
	Uninstall: (reason, from) => { },
	/**
	 * 加载函数。
	 * @param {object} stat - 部件状态对象。
	 * @returns {void}
	 */
	Load: stat => { },
	/**
	 * 卸载函数。
	 * @param {string} reason - 卸载原因。
	 * @returns {void}
	 */
	Unload: reason => { },
	interfaces: {
		chat: {
			/**
			 * 获取问候语。
			 * @returns {object} 问候内容。
			 */
			GetGreeting: () => ({ content: '你好，我是 testAgent。' }),
			/**
			 * 获取群组问候语。
			 * @returns {object} 问候内容。
			 */
			GetGroupGreeting: () => ({ content: '大家好，我是 testAgent。' }),
			/**
			 * 获取提示词。
			 * @returns {Promise<object>} 提示词结构。
			 */
			GetPrompt: async () => ({ text: [{ content: '测试角色。', important: 0 }], additional_chat_log: [], extension: {} }),
			/**
			 * 获取其他角色看到的设定。
			 * @returns {object} 提示词结构。
			 */
			GetPromptForOther: () => ({ text: [{ content: '测试角色。', important: 0 }], additional_chat_log: [], extension: {} }),
			/**
			 * 获取回复。
			 * @returns {Promise<object>} 回复内容。
			 */
			GetReply: async () => ({ content: '测试回复。' }),
		},
	},
}