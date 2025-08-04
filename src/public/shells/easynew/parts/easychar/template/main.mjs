/** @typedef {import('../../../../../src/decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../src/decl/AIsource.ts').AIsource_t} AIsource_t */

import { loadJsonFile, saveJsonFile } from '../../../../../src/scripts/json_loader.mjs'
import path from 'node:path'
import { loadAIsource, loadDefaultAIsource } from '../../../../../src/server/managers/AIsource_manager.mjs'
import { buildPromptStruct } from '../../../../../src/public/shells/chat/src/server/prompt_struct.mjs'
import { evaluateTemplate } from '../../../../../src/public/shells/easynew/src/server/template_engine.mjs'

/** @type {AIsource_t} */
let AIsource
let username
const partRoot = import.meta.dirname
const partJsonPath = path.join(partRoot, 'partdata.json')

/** @type {any} */
let partData = await loadJsonFile(partJsonPath)

const info = {}

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

	async Init(stat) { },
	async Load(stat) {
		username = stat.username
	},
	async Unload(reason) { },
	async Uninstall(reason, from) { },

	interfaces: {
		config: {
			async GetData() {
				return {
					partData,
					AIsource: AIsource?.filename || '',
				}
			},
			async SetData(data) {
				if (data.AIsource) AIsource = await loadAIsource(username, data.AIsource)
				else AIsource = await loadDefaultAIsource(username)
				if (data.partData) {
					partData = data.partData
					await saveJsonFile(partJsonPath, partData)
					updateInfo()
				}
			},
		},
		chat: {
			async GetPrompt(args, prompt_struct, detail_level) {
				const context = {
					char: { name: args.Charname },
					user: { name: args.UserCharname },
					args,
					prompt_struct,
					detail_level,
				}

				const prompt_texts = []
				if (partData.personality)
					prompt_texts.push(`Personality: ${await evaluateTemplate(partData.personality, context)}`)

				if (partData.scenario)
					prompt_texts.push(`Scenario: ${await evaluateTemplate(partData.scenario, context)}`)

				if (partData.mes_example)
					prompt_texts.push(`Message Example: ${await evaluateTemplate(partData.mes_example, context)}`)

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
			async GetGreeting(args, index) {
				if (!partData.first_mes) return null
				const context = {
					char: { name: args.Charname },
					user: { name: args.UserCharname },
					args,
					index,
				}
				return { content: await evaluateTemplate(partData.first_mes, context) }
			},
			async GetReply(arg) {
				if (!AIsource)
					return { content: 'This character does not have an AI source, set the AI source first' }

				const prompt_struct = await buildPromptStruct(arg)
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
				function AddLongTimeLog(entry) {
					entry.charVisibility = [arg.char_id]
					result?.logContextBefore?.push?.(entry)
					prompt_struct.char_prompt.additional_chat_log.push(entry)
				}

				// 在重新生成循环中检查插件触发
				regen: while (true) {
					const requestResult = await AIsource.StructCall(prompt_struct)
					result.content = requestResult.content
					result.files = result.files.concat(requestResult.files || [])
					for (const replyHandler of [
						...Object.values(arg.plugins).map((plugin) => plugin.interfaces?.chat?.ReplyHandler)
					].filter(Boolean))
						if (await replyHandler(result, { ...arg, prompt_struct, AddLongTimeLog }))
							continue regen
					break
				}
				// 返回构建好的回复
				return result
			},
		},
	},
}
