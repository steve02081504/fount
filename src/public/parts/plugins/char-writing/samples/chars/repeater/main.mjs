/**
 * 角色API
 * @typedef {import('../../../../../src/decl/charAPI.ts').CharAPI_t} CharAPI_t
 */

/**
 * 等待指定毫秒。
 * @param {number} ms - 毫秒。
 * @returns {Promise<void>} 等待完成。
 */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * 角色 API 导出类型。
 * @type {CharAPI_t}
 */
export default {
	// 角色的基本信息
	info: {
		'zh-CN': {
			name: '复读机',
			avatar: '',
			description: '一个简单的复读机',
			description_markdown: '这是一个复读机角色，它会流式复读用户的上一条消息。',
			version: '0.0.0',
			author: 'fount',
			home_page: '',
			tags: ['复读', '工具'],
		},
		'en-UK': {
			name: 'Repeater',
			avatar: '',
			description: 'A simple repeater',
			description_markdown: 'A repeater character that streams the last user message back.',
			version: '0.0.0',
			author: 'fount',
			home_page: '',
			tags: ['repeat', 'tool'],
		},
	},

	/**
	 * 初始化函数。
	 * @param {object} stat - 统计信息。
	 * @returns {void}
	 */
	Init: stat => { },
	/**
	 * 安装卸载函数。
	 * @param {string} reason - 卸载原因。
	 * @param {string} from - 卸载来源。
	 * @returns {void}
	 */
	Uninstall: (reason, from) => { },
	/**
	 * 加载函数。
	 * @param {object} stat - 统计信息。
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
			 * 获取开场白。
			 * @param {object} arg - 参数对象，包含 locales。
			 * @param {number} index - 索引。
			 * @returns {object} 开场白条目。
			 */
			GetGreeting: (arg, index) => [{ content: '你好，我是复读机。' }][index],
			/**
			 * 获取群组问好。
			 * @param {object} arg - 参数对象，包含 locales。
			 * @param {number} index - 索引。
			 * @returns {object} 问好条目。
			 */
			GetGroupGreeting: (arg, index) => [{ content: '大家好，我是复读机，我会在群里复读大家的发言。' }][index],
			/**
			 * 获取提示词。
			 * @returns {Promise<object>} 提示词结构。
			 */
			GetPrompt: async () => ({
				text: [],
				additional_chat_log: [],
				extension: {},
			}),
			/**
			 * 获取其他角色看到的设定。
			 * @returns {object} 提示词结构。
			 */
			GetPromptForOther: () => ({
				text: [{
					content: '复读机：一个复述他人输入的角色。',
					important: 0
				}],
				additional_chat_log: [],
				extension: {},
			}),
			/**
			 * 获取回复：逐字流式复读上一条消息，避免一次性瞬发。
			 * @param {object} args - 聊天回复请求。
			 * @returns {Promise<object>} 回复内容。
			 */
			GetReply: async args => {
				/**
				 * 聊天回复结果对象。
				 * @type {import('../../../../../src/public/parts/shells/chat/decl/chatLog.ts').chatReply_t}
				 */
				const result = {
					content: '',
					logContextBefore: [],
					logContextAfter: [],
					files: [],
					extension: {},
				}
				const replyPreviewUpdater = args.generation_options?.replyPreviewUpdater
				const signal = args.generation_options?.signal
				const text = args.chat_log?.at(-1)?.content ?? '没有历史消息可以复读。'
				for (const char of text) {
					if (signal?.aborted) break
					result.content += char
					replyPreviewUpdater?.({ ...result })
					await delay(40)
				}
				return result
			}
		}
	}
}
