import fs from 'node:fs'
import path from 'node:path'

import { regex_placement } from '../../../../../src/public/ImportHandlers/SillyTavern/engine/charData.mjs'
import { getCharacterSource } from '../../../../../src/public/ImportHandlers/SillyTavern/engine/data.mjs'
import { evaluateMacros } from '../../../../../src/public/ImportHandlers/SillyTavern/engine/marco.mjs'
import { promptBuilder } from '../../../../../src/public/ImportHandlers/SillyTavern/engine/prompt_builder.mjs'
import { runRegex } from '../../../../../src/public/ImportHandlers/SillyTavern/engine/regex.mjs'
import { buildPromptStruct } from '../../../../../src/public/shells/chat/src/prompt_struct.mjs'
import { saveJsonFile } from '../../../../../src/scripts/json_loader.mjs'
import { loadAIsource, loadDefaultAIsource } from '../../../../../src/server/managers/AIsource_manager.mjs'

/** @typedef {import('../../../../../src/decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../src/decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../../../src/public/ImportHandlers/SillyTavern/engine/charData.mjs').v2CharData} chardata_t */

/** @type {AIsource_t} */
let AIsource = null

let username = ''

const chardir = import.meta.dirname
const charurl = `/chars/${encodeURIComponent(path.basename(chardir))}`
const charjson = path.join(chardir, 'chardata.json')

/** @type {chardata_t} */
let chardata = JSON.parse(fs.readFileSync(charjson))

/** @type {CharAPI_t} */
export default {
	info: {
		'': {
			name: chardata.name,
			avatar: charurl + '/image.png',
			description: evaluateMacros(chardata.creator_notes, {
				char: chardata.name,
				user: 'user',
				model: 'model',
				charVersion: chardata.character_version,
				char_version: chardata.character_version,
			}).split('\n')[0],
			description_markdown: evaluateMacros(chardata.creator_notes, {
				char: chardata.name,
				user: 'user',
				model: 'model',
				charVersion: chardata.character_version,
				char_version: chardata.character_version,
			}),
			version: chardata.character_version,
			author: chardata.creator || chardata.create_by,
			home_page: getCharacterSource(chardata),
			tags: chardata.tags
		}
	},

	Load: stat => {
		username = stat.username
	},

	interfaces: {
		config: {
			GetData: () => ({
				AIsource: AIsource?.filename || '',
				chardata,
			}),
			SetData: async data => {
				if (data.chardata) {
					chardata = data.chardata
					saveJsonFile(charjson, chardata)
				}
				if (data.AIsource) AIsource = await loadAIsource(username, data.AIsource)
				else AIsource = await loadDefaultAIsource(username)
			}
		},
		chat: {
			GetGreeting: (args, index) => {
				const greetings = [chardata?.first_mes, ...chardata?.alternate_greetings ?? []].filter(x => x)
				if (index >= greetings.length) throw new Error('Invalid index')
				const result = evaluateMacros(greetings[index], {
					char: chardata.name,
					user: args.UserCharname,
					model: AIsource?.filename,
					charVersion: chardata.character_version,
					char_version: chardata.character_version,
				})
				return {
					content: runRegex(chardata, result, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.markdownOnly && !e.promptOnly),
					content_for_show: runRegex(chardata, result, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.promptOnly)
				}
			},
			GetGroupGreeting: (args, index) => {
				const greetings = [...new Set([...chardata?.extensions?.group_greetings ?? [], ...chardata?.group_only_greetings ?? []].filter(x => x))]
				if (index >= greetings.length) throw new Error('Invalid index')
				const result = evaluateMacros(greetings[index], {
					char: chardata.name,
					user: args.UserCharname,
					model: AIsource?.filename,
					charVersion: chardata.character_version,
					char_version: chardata.character_version,
				})
				return {
					content: runRegex(chardata, result, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.markdownOnly && !e.promptOnly),
					content_for_show: runRegex(chardata, result, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.promptOnly)
				}
			},
			GetPrompt: (args) => {
				return promptBuilder(args, chardata, AIsource?.filename)
			},
			// no GetPromptForOther, ST card does not support it
			GetReply: async args => {
				if (!AIsource) return {
					content: 'this character does not have an AI source, [set the AI source](https://steve02081504.github.io/fount/protocol?url=fount://page/shells/AIsourceManage) first',
				}
				// 用fount提供的工具构建提示词结构
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
				function AddLongTimeLog(entry) {
					entry.charVisibility = [args.char_id]
					result?.logContextBefore?.push?.(entry)
					prompt_struct.char_prompt.additional_chat_log.push(entry)
				}

				// 在重新生成循环中检查插件触发
				regen: while (true) {
					const requestResult = await AIsource.StructCall(prompt_struct)
					result.content = requestResult.content
					result.files = result.files.concat(requestResult.files || [])
					for (const replyHandler of [
						...Object.values(args.plugins).map(plugin => plugin.interfaces?.chat?.ReplyHandler)
					].filter(Boolean))
						if (await replyHandler(result, { ...args, prompt_struct, AddLongTimeLog }))
							continue regen
					break
				}
				// 返回构建好的回复
				return {
					content: runRegex(chardata, result.content, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.markdownOnly && !e.promptOnly),
					content_for_show: runRegex(chardata, result.content, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.promptOnly),
					files: result.files
				}
			},
			GetReplyFrequency: async args => {
				if (chardata.extensions.talkativeness) return Number(chardata.extensions.talkativeness) * 2
				return 1
			},
			MessageEdit: args => {
				return {
					...args.edited,
					content: runRegex(chardata, args.edited.content, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.markdownOnly && !e.promptOnly && (e.runOnEdit ?? true)),
					content_for_show: runRegex(chardata, args.edited.content, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.promptOnly && (e.runOnEdit ?? true)),
				}
			}
		}
	}
}
