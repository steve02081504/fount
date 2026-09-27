import fs from 'node:fs'
import path from 'node:path'

import { createLongTimeLogger, runBeforeReplyHooks, runReplyHandlers } from 'fount/public/parts/shells/chat/src/reply/handlerPipeline.mjs'

/**
 * 角色 API 类型别名。
 * @typedef {import('../../../../../../../../src/decl/charAPI.ts').CharAPI_t} CharAPI_t
 */
/** 首轮 StructCall 前已看到预读内容时的最终回答（无工具调用，单轮结束）。 */
const SEEN = '首轮已见预读内容，直接回答。'
/** 每字符分片间隔（ms）。 */
const CHUNK_DELAY = 10

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
 * code shell 集成测试用预读角色：在首次 StructCall 前调用 `runBeforeReplyHooks`，
 * 并把首轮 `prompt_struct.char_prompt.additional_chat_log` 追加写入工作区的
 * `preload_observations.jsonl` 供测试观测（fixture 专用钩子，不影响生产路径）。
 * @type {CharAPI_t}
 */
export default {
	info: {
		'zh-CN': {
			name: 'wsPreloadChar',
			avatar: '',
			description: 'code shell 集成测试用预读角色',
			description_markdown: 'code shell 集成测试用预读角色。',
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
			 * 获取回复：首轮前运行生成前钩子并记录观测，随后单轮回答。
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
				// 与 wsRoundsChar 一致：不提供 prompt_struct.chat_log，让插件回退到 args.chat_log 解析最新用户消息
				const prompt_struct = { char_prompt: { additional_chat_log: [] } }
				const AddLongTimeLog = createLongTimeLogger(args, result, prompt_struct)
				await runBeforeReplyHooks({ ...args, prompt_struct, AddLongTimeLog })
				// fixture 观测钩子：记录首轮 StructCall 看到的追加日志（合并后的 prompt 侧额外日志）
				try {
					if (args.workdir?.path)
						fs.appendFileSync(
							path.join(args.workdir.path, 'preload_observations.jsonl'),
							JSON.stringify({ additionalChatLog: prompt_struct.char_prompt.additional_chat_log.map(entry => ({ name: entry.name, content: entry.content })) }) + '\n',
							'utf8'
						)
				}
				catch { /* 观测失败不影响生成 */ }
				const handlers = Object.values(args.plugins || {}).map(plugin => plugin.interfaces?.chat?.ReplyHandler).filter(Boolean)
				regen: while (true) {
					result.content = ''
					delete result.content_for_show
					for (const chunk of Array.from(SEEN)) {
						await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY))
						result.content += chunk
						// 与真实 AI 源一致：预览传浅拷贝（不带累计 logContextBefore），增量日志须读 base_result
						previewUpdater?.({ ...result })
					}
					if (await runReplyHandlers(result, { ...args, prompt_struct, AddLongTimeLog }, handlers)) {
						if (!await args.generation_options.finishRound?.()) break regen
						continue regen
					}
					break
				}
				return result
			},
		},
	},
}
