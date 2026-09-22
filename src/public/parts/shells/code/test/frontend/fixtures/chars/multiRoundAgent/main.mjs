import { runReplyHandlers } from 'fount/public/parts/shells/chat/src/reply/handlerPipeline.mjs'
import { injectRoundEntries } from 'fount/public/parts/shells/chat/src/reply/roundContext.mjs'

/**
 * 角色 API 类型别名。
 * @typedef {import('../../../../../../../../../../src/decl/charAPI.ts').CharAPI_t} CharAPI_t
 */
/** 第一轮：触发 file-operations 工具调用（结束后管线建议重生成）。 */
const ROUND1 = '先读取文件。<view-file>\nnote.txt\n</view-file>'
/** 第二轮：无工具调用，作为最终回答。 */
const ROUND2 = '读取完成，这是最终回答。'
/** 每字符分片间隔（ms），放慢流式以便生成中捕获中间条目。 */
const CHUNK_DELAY = 30

/**
 * 等待指定毫秒。
 * @param {number} ms - 毫秒。
 * @returns {Promise<void>} 完成。
 */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * code shell 前端测试用多轮角色：按真实模板方式驱动回复管线，
 * 第一轮工具调用结束后重生成，验证中间条目在生成中即追加到消息流。
 * @type {CharAPI_t}
 */
export default {
	info: {
		'zh-CN': {
			name: 'multiRoundAgent',
			avatar: '',
			description: 'code shell 前端测试用多轮工具角色',
			description_markdown: 'code shell 前端测试用多轮工具角色。',
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
			GetGreeting: () => ({ content: '你好，我是 multiRoundAgent。' }),
			/**
			 * 获取群组问候语。
			 * @returns {object} 问候内容。
			 */
			GetGroupGreeting: () => ({ content: '大家好，我是 multiRoundAgent。' }),
			/**
			 * 获取提示词。
			 * @returns {Promise<object>} 提示词结构。
			 */
			GetPrompt: async () => ({ text: [{ content: '多轮测试角色。', important: 0 }], additional_chat_log: [], extension: {} }),
			/**
			 * 获取其他角色看到的设定。
			 * @returns {Promise<object>} 提示词结构。
			 */
			GetPromptForOther: async () => ({ text: [{ content: '多轮测试角色。', important: 0 }], additional_chat_log: [], extension: {} }),
			/**
			 * 获取回复：逐轮分片推送预览并按真实模板方式运行插件 ReplyHandler。
			 * @param {object} args - 聊天回复请求。
			 * @returns {Promise<object>} 回复内容。
			 */
			GetReply: async args => {
				args.generation_options ??= {}
				const previewUpdater = args.generation_options.replyPreviewUpdater
				/** @type {object} */
				const result = { content: '', logContextBefore: [], logContextAfter: [], files: [], extension: {} }
				const oriPreviewUpdater = previewUpdater
				// 与真实模板一致：把本轮 result 暴露为 base_result，供后端在预览时读取累积日志
				args.generation_options.base_result = result
				const prompt_struct = { chat_log: [], char_prompt: { additional_chat_log: [] } }
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
				regen: while (true) {
					const text = result.logContextBefore.length ? ROUND2 : ROUND1
					result.content = ''
					delete result.content_for_show
					for (const chunk of Array.from(text)) {
						await delay(CHUNK_DELAY)
						result.content += chunk
						oriPreviewUpdater?.(result)
					}
					if (await runReplyHandlers(result, { ...args, prompt_struct, AddLongTimeLog }, handlers)) {
						await injectRoundEntries(args, prompt_struct)
						continue regen
					}
					break
				}
				return result
			},
		},
	},
}
