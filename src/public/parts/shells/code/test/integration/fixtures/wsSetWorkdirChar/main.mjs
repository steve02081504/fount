import { createLongTimeLogger, runBeforeReplyHooks, runReplyHandlers } from 'fount/public/parts/shells/chat/src/reply/handlerPipeline.mjs'
import { injectRoundEntries } from 'fount/public/parts/shells/chat/src/reply/roundContext.mjs'

/**
 * 角色 API 类型别名。
 * @typedef {import('../../../../../../../../src/decl/charAPI.ts').CharAPI_t} CharAPI_t
 */

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
 * code shell 测试用角色：首轮 `<set-workdir>` 切到 `sub`，随后读 `note.txt`；
 * 会话记忆里已有 workdir 时直接读，用于验证设置跨轮次/跨运行持续有效。
 * @type {CharAPI_t}
 */
export default {
	info: {
		'zh-CN': {
			name: 'wsSetWorkdirChar',
			avatar: '',
			description: 'code shell 设置工作目录测试角色',
			description_markdown: 'code shell 设置工作目录测试角色。',
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
			 * 获取回复：按轮次决定工具调用并按真实模板方式运行插件 ReplyHandler。
			 * @param {object} args - 聊天回复请求。
			 * @returns {Promise<object>} 回复内容。
			 */
			GetReply: async args => {
				args.generation_options ??= {}
				args.plugins = { ...args.plugins, ...await loadPlugins(args.username, ['file-operations']) }
				const previewUpdater = args.generation_options.replyPreviewUpdater
				/** @type {object} */
				const result = { content: '', logContextBefore: [], logContextAfter: [], files: [], extension: {} }
				args.generation_options.base_result = result
				const prompt_struct = { chat_log: [], char_prompt: { additional_chat_log: [] } }
				const AddLongTimeLog = createLongTimeLogger(args, result, prompt_struct)
				await runBeforeReplyHooks({ ...args, prompt_struct, AddLongTimeLog })
				const handlers = Object.values(args.plugins || {}).map(plugin => plugin.interfaces?.chat?.ReplyHandler).filter(Boolean)
				regen: while (true) {
					const memoryWorkdir = args.chat_scoped_char_memory?.workdir?.path
					const base = args.workdir?.path || ''
					const viewed = result.logContextBefore.some(entry => entry.name === 'file-operations.view-file')
					// 本 fixture 是脚本角色，不接 AI：历史里已下发过 <set-workdir> 就不再重复下发。
					// 否则第二次运行时它会重新设置工作目录，从而掩盖“请求未沿用持久化 workdir”的缺陷。
					const edited = result.logContextBefore.some(entry => entry.name === 'file-operations.set-workdir')
						|| (args.chat_log || []).some(entry => entry.name === 'file-operations.set-workdir')
					let text
					if (!memoryWorkdir && !edited) text = `<set-workdir path="${base}/sub"></set-workdir>`
					else if (!viewed) text = '<view-file>note.txt</view-file>'
					else text = '完成'
					result.content = text
					delete result.content_for_show
					previewUpdater?.({ ...result })
					if (await runReplyHandlers(result, { ...args, prompt_struct, AddLongTimeLog }, handlers)) {
						await injectRoundEntries(args, prompt_struct)
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
