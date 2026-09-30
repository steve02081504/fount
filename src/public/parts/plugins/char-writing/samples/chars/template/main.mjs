/**
 * 角色API
 * @typedef {import('../../../../../src/decl/charAPI.ts').CharAPI_t} CharAPI_t
 * 插件API
 * @typedef {import('../../../../../src/decl/pluginAPI.ts').PluginAPI_t} PluginAPI_t
 */

import { buildPromptStruct } from '../../../../../src/public/parts/shells/chat/src/prompt_struct/index.mjs'
import { createLongTimeLogger, runBeforeReplyHooks, runReplyHandlers } from '../../../../../src/public/parts/shells/chat/src/reply/handlerPipeline.mjs'
import { finishToolRound } from '../../../../../src/public/parts/shells/chat/src/reply/roundContext.mjs'
import { loadPart, loadAnyPreferredDefaultPart } from '../../../../../src/server/parts_loader.mjs'

/**
 * AI源的实例
 * @type {import('../../../../../src/decl/AIsource.ts').AIsource_t}
 */
let AIsource = null

/**
 * 已加载的插件映射表。
 * @type {Record<string, PluginAPI_t>}
 */
let plugins = {}

// 用户名，用于加载AI源
let username = ''

/**
 * 角色 API 导出类型。
 * @type {CharAPI_t}
 */
export default {
	// 角色的基本信息，这里的内容不会被角色知道
	info: {
		'zh-CN': {
			name: '<角色名>', // 角色的名字
			avatar: '<头像的url地址，可以留空，也可以是fount本地文件>', // 角色的头像
			description: '<角色的一句话介绍>', // 角色的简短介绍
			description_markdown: '<角色的完整介绍，支持markdown语法>', // 角色的详细介绍，支持Markdown语法
			version: '0.0.0', // 角色的版本号
			author: '<作者名>', // 角色的作者
			home_page: '', // 角色的主页
			tags: ['<标签>', '<可以多个>'], // 角色的标签
		}
	},

	/**
	 * 初始化函数，在角色被启用时调用，可留空。
	 * @param {object} stat - 统计信息。
	 * @returns {void}
	 */
	Init: stat => { },

	/**
	 * 安装卸载函数，在角色被安装/卸载时调用。
	 * @param {string} reason - 卸载原因。
	 * @param {string} from - 卸载来源。
	 * @returns {void}
	 */
	Uninstall: (reason, from) => { },

	/**
	 * 加载函数，在角色被加载时调用。
	 * @param {object} stat - 统计信息。
	 * @returns {void}
	 */
	Load: stat => {
		username = stat.username // 获取用户名
	},

	/**
	 * 卸载函数，在角色被卸载时调用。
	 * @param {string} reason - 卸载原因。
	 * @returns {void}
	 */
	Unload: reason => { },

	// 角色的接口
	interfaces: {
		// 角色的配置接口
		config: {
			/**
			 * 获取角色的配置数据。
			 * @returns {object} - 包含 AI 源文件名的对象。
			 */
			GetData: () => ({
				AIsource: AIsource?.filename || '', // 返回当前使用的AI源的文件名
				plugins: Object.keys(plugins),
			}),
			/**
			 * 设置角色的配置数据。
			 * @param {object} data - 包含 AI 源配置的数据。
			 * @returns {Promise<void>}
			 */
			SetData: async data => {
				// 如果传入了AI源的配置
				if (data.AIsource) AIsource = await loadPart(username, 'serviceSources/AI/' + data.AIsource) // 加载AI源
				else AIsource = await loadAnyPreferredDefaultPart(username, 'serviceSources/AI') // 或加载默认AI源（若未设置默认AI源则为undefined）
				if (data.plugins) plugins = Object.fromEntries(await Promise.all(data.plugins.map(async x => [x, await loadPart(username, 'plugins/' + x)])))
			}
		},
		// 角色的聊天接口
		chat: {
			/**
			 * 获取角色的开场白。
			 * @param {object} arg - 参数对象，包含 locales。
			 * @param {number} index - 索引。
			 * @returns {object} - 开场白条目。
			 */
			GetGreeting: (arg, index) => [{ content: '<角色的开场白>' }, { content: '<可以多个>' }][index],
			/**
			 * 获取角色在群组中的问好。
			 * @param {object} arg - 参数对象，包含 locales。
			 * @param {number} index - 索引。
			 * @returns {object} - 问好条目。
			 */
			GetGroupGreeting: (arg, index) => [{ content: '<群组中角色加入时的问好>' }, { content: '<可以多个>' }][index],
			/**
			 * 获取角色的提示词。
			 * @param {object} args - 参数对象。
			 * @returns {Promise<object>} - 包含提示词结构的对象。
			 */
			GetPrompt: async args => {
				return {
					text: [{
						content: '<角色的完整设定内容>',
						important: 0
					}],
					additional_chat_log: [],
					extension: {},
				}
			},
			/**
			 * 获取其他角色看到的该角色的设定，群聊时生效。
			 * @param {object} args - 参数对象。
			 * @returns {object} - 包含提示词结构的对象。
			 */
			GetPromptForOther: (args) => {
				return {
					text: [{
						content: '<其他角色看到的该角色的设定，群聊时生效>',
						important: 0
					}],
					additional_chat_log: [],
					extension: {},
				}
			},
			/**
			 * 获取角色的回复。
			 * @param {object} args - 参数对象。
			 * @returns {Promise<object>} - 包含回复内容的对象。
			 */
			GetReply: async args => {
				// 如果没有设置AI源，返回默认回复
				if (!AIsource) return { content: '<未设置角色的AI来源时角色的对话回复，可以用markdown语法链接到[设置AI源](https://steve02081504.github.io/fount/protocol?url=fount://page/parts/shells:serviceSourceManage)>' }
				// 注入角色插件
				args.plugins = Object.assign({}, plugins, args.plugins)
				// 用fount提供的工具构建提示词结构
				const prompt_struct = await buildPromptStruct(args)
				// 创建回复容器
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
				// 构建插件可能需要的追加上下文函数
				const AddLongTimeLog = createLongTimeLogger(args, result, prompt_struct)

				await runBeforeReplyHooks({ ...args, prompt_struct, AddLongTimeLog })
				// 构建更新预览管线
				args.generation_options ??= {}
				const oriReplyPreviewUpdater = args.generation_options?.replyPreviewUpdater
				/**
				 * 聊天回复预览更新管道。
				 * @type {import('../../../../../src/public/parts/shells/chat/decl/chatLog.ts').CharReplyPreviewUpdater_t}
				 */
				let replyPreviewUpdater = (args, r) => oriReplyPreviewUpdater?.(r)
				for (const GetReplyPreviewUpdater of [
					...Object.values(args.plugins).map(plugin => plugin.interfaces?.chat?.GetReplyPreviewUpdater)
				].filter(Boolean))
					replyPreviewUpdater = GetReplyPreviewUpdater(replyPreviewUpdater)

				/**
				 * 更新回复预览。
				 * @param {object} r - 来自 AI 的回复块。
				 * @returns {void}
				 */
				args.generation_options.replyPreviewUpdater = r => replyPreviewUpdater(args, r)

				const handlers = [
					...Object.values(args.plugins).map(plugin => plugin.interfaces?.chat?.ReplyHandler)
				].filter(Boolean)
				// 在重新生成循环中检查插件触发
				regen: while (true) {
					args.generation_options.base_result = result
					await AIsource.StructCall(prompt_struct, args.generation_options)
					if (await runReplyHandlers(result, { ...args, prompt_struct, AddLongTimeLog }, handlers)) {
						if (await finishToolRound(args, prompt_struct)) continue regen
						break
					}
					break
				}
				// 返回构建好的回复
				return result
			}
		}
	}
}
