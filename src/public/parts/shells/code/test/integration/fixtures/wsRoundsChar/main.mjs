import { createLongTimeLogger, runBeforeReplyHooks, runReplyHandlers } from 'fount/public/parts/shells/chat/src/reply/handlerPipeline.mjs'
import { finishToolRound } from 'fount/public/parts/shells/chat/src/reply/roundContext.mjs'
/**
 * 角色 API 类型别名。
 * @typedef {import('../../../../../../../../src/decl/charAPI.ts').CharAPI_t} CharAPI_t
 */
/** 第一轮：触发 file-operations 工具调用（结束后管线建议重生成）。 */
const ROUND1 = '读取文件。<view-file>\nnote.txt\n</view-file>'
/** 第二轮：最终回答。 */
const ROUND2 = '读取完成。'

/**
 * 加载本角色声明的插件（code shell 不再默认注入）。
 * @param {string} username - 用户名。
 * @param {string[]} names - 插件名列表。
 * @returns {Promise<object>} 插件表（名 -> 部件实例）。
 */
async function loadPlugins(username, names) {
	const { loadPart } = await import('fount/server/parts_loader.mjs')
	return Object.fromEntries(await Promise.all(names.map(async name => [name, await loadPart(username, 'plugins/' + name)])))
}

/**
 * code shell 集成测试用多轮角色：第一轮工具调用后重生成，
 * 用于验证 WS 在生成中增量推送已完成条目（entries-append）。
 * @type {CharAPI_t}
 */
export default {
	info: {
		'zh-CN': {
			name: 'wsRoundsChar',
			avatar: '',
			description: 'code shell 集成测试用多轮角色',
			description_markdown: 'code shell 集成测试用多轮角色。',
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
			 * @returns {{content: string}} 问候内容。
			 */
			GetGreeting: () => ({ content: '你好。' }),
			/**
			 * 获取群组问候语。
			 * @returns {{content: string}} 问候内容。
			 */
			GetGroupGreeting: () => ({ content: '大家好。' }),
			/**
			 * 获取提示词。
			 * @returns {Promise<object>} 提示词结构。
			 */
			GetPrompt: async () => ({ text: [], additional_chat_log: [], extension: {} }),
			/**
			 * 获取其他角色看到的设定。
			 * @returns {object} 提示词结构。
			 */
			GetPromptForOther: () => ({ text: [], additional_chat_log: [], extension: {} }),
			/**
			 * 获取回复：逐轮推送预览并按真实模板方式运行插件 ReplyHandler。
			 * @param {object} args - 聊天回复请求。
			 * @returns {Promise<object>} 回复内容。
			 */
			GetReply: async args => {
				args.generation_options ??= {}
				args.plugins = { ...args.plugins, ...await loadPlugins(args.username, ['file-operations']) }
				const previewUpdater = args.generation_options.replyPreviewUpdater
				/** @type {object} */
				const result = { content: '', logContextBefore: [], logContextAfter: [], files: [], extension: {} }
				// 与真实模板一致：把本轮 result 暴露为 base_result，供后端在预览时读取累积日志
				args.generation_options.base_result = result
				const prompt_struct = { char_prompt: { additional_chat_log: [] } }
				const AddLongTimeLog = createLongTimeLogger(args, result, prompt_struct)
				await runBeforeReplyHooks({ ...args, prompt_struct, AddLongTimeLog })
				const handlers = Object.values(args.plugins || {}).map(plugin => plugin.interfaces?.chat?.ReplyHandler).filter(Boolean)
				regen: while (true) {
					const text = result.logContextBefore.length || args.chat_log.some(entry => entry.role === 'tool') ? ROUND2 : ROUND1
					result.content = ''
					delete result.content_for_show
					for (const chunk of Array.from(text)) {
						await new Promise(resolve => setTimeout(resolve, args.chat_name === 'code-resume01' && text === ROUND2 ? 200 : 20))
						result.content += chunk
						// 与真实 AI 源一致：预览传浅拷贝（不带累计 logContextBefore），增量日志须读 base_result
						previewUpdater?.({ ...result })
					}
					if (await runReplyHandlers(result, { ...args, prompt_struct, AddLongTimeLog }, handlers)) {
						if (await finishToolRound(args, prompt_struct)) continue regen
						break regen
					}
					break
				}
				return result
			},
		},
	},
}
