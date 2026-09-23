import { runReplyHandlers } from 'fount/public/parts/shells/chat/src/reply/handlerPipeline.mjs'
/**
 * 角色 API 类型别名。
 * @typedef {import('../../../../../../../../../../src/decl/charAPI.ts').CharAPI_t} CharAPI_t
 */
/** 固定的工具调用回复（run-js 分段输出，便于前端在生成中捕获实时工具卡）。 */
const REPLY = '<run-js>for (let i = 0; i < 5; i++) { console.log("live-tool-output"); await new Promise(resolve => setTimeout(resolve, 400)) } return 1</run-js>'

/**
 * code shell 前端测试用工具角色：返回 `<run-js>` 并按真实模板方式驱动消息管线。
 * @type {CharAPI_t}
 */
export default {
	info: {
		'zh-CN': {
			name: 'toolAgent',
			avatar: '',
			description: 'code shell 前端测试用工具角色',
			description_markdown: 'code shell 前端测试用工具角色。',
			version: '0.0.0',
			author: 'fount test',
			home_page: '',
			tags: ['test'],
		},
	},
	/**
	 * 初始化函数。
	 * @returns {void}
	 */
	Init: () => { },
	/**
	 * 卸载函数。
	 * @returns {void}
	 */
	Uninstall: () => { },
	/**
	 * 加载函数。
	 * @returns {void}
	 */
	Load: () => { },
	/**
	 * 卸载函数。
	 * @returns {void}
	 */
	Unload: () => { },
	interfaces: {
		chat: {
			/**
			 * 获取问候语。
			 * @returns {object} 问候内容。
			 */
			GetGreeting: () => ({ content: '你好，我是 toolAgent。' }),
			/**
			 * 获取群组问候语。
			 * @returns {object} 问候内容。
			 */
			GetGroupGreeting: () => ({ content: '大家好，我是 toolAgent。' }),
			/**
			 * 获取提示词。
			 * @returns {Promise<object>} 提示词结构。
			 */
			GetPrompt: async () => ({ text: [{ content: '工具测试角色。', important: 0 }], additional_chat_log: [], extension: {} }),
			/**
			 * 获取其他角色看到的设定。
			 * @returns {Promise<object>} 提示词结构。
			 */
			GetPromptForOther: async () => ({ text: [{ content: '工具测试角色。', important: 0 }], additional_chat_log: [], extension: {} }),
			/**
			 * 获取回复：返回固定工具调用并按真实模板方式运行插件 ReplyHandler。
			 * @param {object} args - 聊天回复请求。
			 * @returns {Promise<object>} 回复内容。
			 */
			GetReply: async args => {
				const prompt_struct = { char_prompt: { additional_chat_log: [] } }
				const result = { content: REPLY, logContextBefore: [], logContextAfter: [], files: [], extension: {} }
				const continueAfterTool = args.chat_log.some(entry => entry.role === 'user' && entry.content === '工具后继续生成')
				/**
				 * 追加长时间日志。
				 * @param {object} entry - 日志条目。
				 * @returns {void}
				 */
				function AddLongTimeLog(entry) {
					entry.uid ??= entry.role === 'char' ? args.CharUid : entry.role === 'user' ? args.UserUid : 'system'
					entry.charVisibility ??= [args.char_id]
					result.logContextBefore.push(entry)
					prompt_struct.char_prompt.additional_chat_log.push(entry)
				}
				const handlers = Object.values(args.plugins || {}).map(plugin => plugin.interfaces?.chat?.ReplyHandler).filter(Boolean)
				args.generation_options ??= {}
				args.generation_options.replyPreviewUpdater?.(result)
				await runReplyHandlers(result, { ...args, prompt_struct, AddLongTimeLog }, handlers)
				if (continueAfterTool) {
					result.content_for_show = '工具已经执行完，正在继续生成正文。'
					args.generation_options.replyPreviewUpdater?.(result)
					await new Promise(resolve => setTimeout(resolve, 6000))
				}
				return result
			},
		},
	},
}
