/** @typedef {import('../../../../../src/decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../src/decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../../../src/decl/pluginAPI.ts').PluginAPI_t} PluginAPI_t */

import path from 'node:path'

import { buildPromptStruct } from '../../../../../src/public/shells/chat/src/prompt_struct.mjs'
import { formatStr } from '../../../../../src/scripts/format.mjs'
import { loadJsonFile, saveJsonFile } from '../../../../../src/scripts/json_loader.mjs'
import { loadAIsource, loadDefaultAIsource } from '../../../../../src/server/managers/AIsource_manager.mjs'
import { loadPlugin } from '../../../../../src/server/managers/plugin_manager.mjs'

/** @type {AIsource_t} */
let AIsource
/** @type {Record<string, PluginAPI_t>} */
let plugins = {}
let username
const partRoot = import.meta.dirname
const partJsonPath = path.join(partRoot, 'partdata.json')

/** @type {any} */
let partData = await loadJsonFile(partJsonPath)

const info = {}

/**
 * @returns {void}
 */
function updateInfo() {
	const charUrl = `/chars/${encodeURIComponent(partData.name)}`
	info[''] = {
		name: partData.name,
		avatar: partData.has_avatar ? `${charUrl}/image.png` : '',
		description: partData.description,
		description_markdown: partData.description_markdown,
		version: partData.version,
		author: partData.author,
		home_page: partData.home_page,
		issue_page: partData.issue_page,
		tags: partData.tags,
	}
}
updateInfo()

/** @type {CharAPI_t} */
export default {
	info,
	/**
	 * 初始化函数。
	 * @param {import('../../../../../src/decl/part.ts').part_stat_t} stat - 部件状态对象。
	 * @returns {Promise<void>}
	 */
	async Init(stat) { },
	/**
	 * 加载函数。
	 * @param {import('../../../../../src/decl/part.ts').part_stat_t} stat - 部件状态对象。
	 * @returns {Promise<void>}
	 */
	async Load(stat) {
		username = stat.username
	},
	/**
	 * 卸载函数。
	 * @param {string} reason - 卸载原因。
	 * @returns {Promise<void>}
	 */
	async Unload(reason) { },
	/**
	 * 卸载函数。
	 * @param {string} reason - 卸载原因。
	 * @param {string} from - 来源。
	 * @returns {Promise<void>}
	 */
	async Uninstall(reason, from) { },

	interfaces: {
		config: {
			/**
			 * 获取数据。
			 * @returns {Promise<{partData: any, AIsource: string}>} 返回包含部件数据和 AI 源的 Promise。
			 */
			async GetData() {
				return {
					partData,
					AIsource: AIsource?.filename || '',
					plugins: Object.keys(plugins),
				}
			},
			/**
			 * 设置数据。
			 * @param {{partData: any, AIsource: string}} data - 包含部件数据和 AI 源的对象。
			 * @returns {Promise<void>}
			 */
			async SetData(data) {
				if (data.AIsource) AIsource = await loadAIsource(username, data.AIsource)
				else AIsource = await loadDefaultAIsource(username)
				if (data.plugins) plugins = Object.fromEntries(await Promise.all(data.plugins.map(async x => [x, await loadPlugin(username, x)])))
				if (data.partData) {
					partData = data.partData
					await saveJsonFile(partJsonPath, partData)
					updateInfo()
				}
			},
		},
		chat: {
			/**
			 * 获取提示。
			 * @param {import('../../../../../src/public/shells/chat/decl/chat.ts').ChatRequest_t} args - 聊天请求参数。
			 * @returns {Promise<{text: {content: string, description: string, important: number}[], additional_chat_log: [], extension: {}}>} 返回一个包含提示信息的 Promise。
			 */
			async GetPrompt(args) {
				const context = {
					char: { name: args.Charname },
					user: { name: args.UserCharname },
					args,
				}

				const prompt_texts = []
				if (partData.personality)
					prompt_texts.push(`Personality: ${await formatStr(partData.personality, context)}`)

				if (partData.scenario)
					prompt_texts.push(`Scenario: ${await formatStr(partData.scenario, context)}`)

				if (partData.mes_example)
					prompt_texts.push(`Message Example: ${await formatStr(partData.mes_example, context)}`)

				return {
					text: [{
						content: prompt_texts.join('\n\n'),
						description: '',
						important: 0,
					}],
					additional_chat_log: [],
					extension: {},
				}
			},
			/**
			 * 获取问候语。
			 * @param {import('../../../../../src/public/shells/chat/decl/chat.ts').ChatRequest_t} args - 聊天请求参数。
			 * @param {number} index - 索引。
			 * @returns {Promise<{content: string}>} 返回一个包含问候语内容的 Promise。
			 */
			async GetGreeting(args, index) {
				if (!partData.first_mes) return null
				const context = {
					char: { name: args.Charname },
					user: { name: args.UserCharname },
					args,
					index,
				}
				return { content: await formatStr(partData.first_mes, context) }
			},
			/**
			 * 获取回复。
			 * @param {import('../../../../../src/public/shells/chat/decl/chat.ts').ChatRequest_t} args - 聊天请求参数。
			 * @returns {Promise<import("../../../../../src/public/shells/chat/decl/chatLog.ts").chatReply_t>} 返回一个包含聊天回复的 Promise。
			 */
			async GetReply(args) {
				if (!AIsource)
					return { content: 'This character does not have an AI source, [set the AI source](https://steve02081504.github.io/fount/protocol?url=fount://page/shells/AIsourceManage) first' }

				args.plugins = Object.assign({}, plugins, args.plugins)
				const prompt_struct = await buildPromptStruct(args)
				// 创建回复容器
				/** @type {import("../../../../../src/public/shells/chat/decl/chatLog.ts").chatReply_t} */
				const result = {
					content: '',
					logContextBefore: [],
					logContextAfter: [],
					files: [],
					extension: {},
				}
				// 构建插件可能需要的追加上下文函数
				/**
				 * 添加长时间日志。
				 * @param {import('../../../../../src/public/shells/chat/decl/chatLog.ts').chatLogEntry_t} entry - 聊天日志条目。
				 * @returns {void}
				 */
				function AddLongTimeLog(entry) {
					entry.charVisibility = [args.char_id]
					result?.logContextBefore?.push?.(entry)
					prompt_struct.char_prompt.additional_chat_log.push(entry)
				}

				// 构建更新预览管线
				args.generation_options ??= {}
				let replyPreviewUpdater = args.generation_options?.replyPreviewUpdater
				for (const GetReplyPreviewUpdater of [
					...Object.values(args.plugins).map(plugin => plugin.interfaces?.chat?.GetReplyPreviewUpdater)
				].filter(Boolean))
					replyPreviewUpdater = GetReplyPreviewUpdater(replyPreviewUpdater)

				args.generation_options.replyPreviewUpdater = replyPreviewUpdater

				// 在重新生成循环中检查插件触发
				regen: while (true) {
					args.generation_options.base_result = result
					await AIsource.StructCall(prompt_struct, args.generation_options)
					let continue_regen = false
					for (const replyHandler of [
						...Object.values(args.plugins).map(plugin => plugin.interfaces?.chat?.ReplyHandler)
					].filter(Boolean))
						if (await replyHandler(result, { ...args, prompt_struct, AddLongTimeLog }))
							continue_regen = true
					if (continue_regen) continue regen
					break
				}
				// 返回构建好的回复
				return result
			},
		},
	},
}
