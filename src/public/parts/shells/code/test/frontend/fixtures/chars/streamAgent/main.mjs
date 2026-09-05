/**
 * 角色 API 类型别名。
 * @typedef {import('../../../../../../../src/decl/charAPI.ts').CharAPI_t} CharAPI_t
 */
/** 分片流式内容（800ms/片，模拟真实 AI 流式节奏，供生成中气泡断言增量文本）。 */
const STREAM_CHUNKS = ['流式第一', '段。', '流式第二', '段。']

/**
 * 等待指定毫秒。
 * @param {number} ms - 毫秒。
 * @returns {Promise<void>} 完成。
 */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * code shell 前端测试用流式角色：模仿真实角色模板的 replyPreviewUpdater 包装，
 * 请求级 AI 源存在时走 StructCall，否则自行分片推送预览。
 * @type {CharAPI_t}
 */
export default {
	info: {
		'zh-CN': {
			name: 'streamAgent',
			avatar: '',
			description: 'code shell 前端测试用流式回复角色',
			description_markdown: 'code shell 前端测试用流式回复角色。',
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
			GetGreeting: () => ({ content: '你好，我是 streamAgent。' }),
			/**
			 * 获取群组问候语。
			 * @returns {object} 问候内容。
			 */
			GetGroupGreeting: () => ({ content: '大家好，我是 streamAgent。' }),
			/**
			 * 获取提示词。
			 * @returns {Promise<object>} 提示词结构。
			 */
			GetPrompt: async () => ({ text: [{ content: '流式测试角色。', important: 0 }], additional_chat_log: [], extension: {} }),
			/**
			 * 获取其他角色看到的设定。
			 * @returns {object} 提示词结构。
			 */
			GetPromptForOther: () => ({ text: [{ content: '流式测试角色。', important: 0 }], additional_chat_log: [], extension: {} }),
			/**
			 * 获取回复：包装 replyPreviewUpdater 后分片推送预览（有请求级 AI 源则委托 StructCall）。
			 * @param {object} args - 聊天回复请求。
			 * @returns {Promise<object>} 回复内容。
			 */
			GetReply: async args => {
				args.generation_options ??= {}
				const oriReplyPreviewUpdater = args.generation_options?.replyPreviewUpdater
				/**
				 * 预览包装（对齐真实角色模板：先经本层再透传请求级更新器）。
				 * @param {object} _wrappedArgs - 角色请求上下文（未使用）。
				 * @param {object} reply - 预览回复。
				 * @returns {void}
				 */
				const replyPreviewUpdater = (_wrappedArgs, reply) => oriReplyPreviewUpdater?.(reply)
				/**
				 * 请求级预览更新器入口。
				 * @param {object} reply - 预览回复。
				 * @returns {void}
				 */
				args.generation_options.replyPreviewUpdater = reply => replyPreviewUpdater(args, reply)
				const result = { content: '', logContextBefore: [], logContextAfter: [], files: [], extension: {} }
				if (args.ai_source?.StructCall) {
					args.generation_options.base_result = result
					await args.ai_source.StructCall({ text: [] }, args.generation_options)
					return result
				}
				// 无请求级 AI 源（角色自带）：角色自行分片推送预览
				for (const chunk of STREAM_CHUNKS) {
					await delay(800)
					result.content += chunk
					args.generation_options.replyPreviewUpdater({ ...result })
				}
				return result
			},
		},
	},
}
