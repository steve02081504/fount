import fs from 'node:fs'
import path from 'node:path'
import { loadAIsource } from '../../../../../src/server/managers/AIsources_manager.mjs'
import { saveJsonFile } from '../../../../../src/scripts/json_loader.mjs'
import { promptBuilder } from '../../../../../src/public/ImportHanlders/SillyTavern/engine/prompt_builder.mjs'
import { buildPromptStruct } from '../../../../../src/public/shells/chat/src/server/prompt_struct.mjs'
import { runRegex } from '../../../../../src/public/ImportHanlders/SillyTavern/engine/regex.mjs'
import { regex_placement } from '../../../../../src/public/ImportHanlders/SillyTavern/engine/charData.mjs'
import { evaluateMacros } from '../../../../../src/public/ImportHanlders/SillyTavern/engine/marco.mjs'
import { getCharacterSource } from '../../../../../src/public/ImportHanlders/SillyTavern/engine/data.mjs'

/** @typedef {import('../../../../../src/decl/charAPI.ts').charAPI_t} charAPI_t */
/** @typedef {import('../../../../../src/decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../../../src/public/ImportHanlders/SillyTavern/engine/charData.mjs').v2CharData} chardata_t */

/** @type {AIsource_t} */
let AIsource = null

let username = ''

const chardir = import.meta.dirname
const charurl = `/chars/${encodeURIComponent(path.basename(chardir))}`
const charjson = path.join(chardir, 'chardata.json')

/** @type {chardata_t} */
let chardata = JSON.parse(fs.readFileSync(charjson))

/** @type {charAPI_t} */
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
			homepage: getCharacterSource(chardata),
			tags: chardata.tags
		}
	},

	Init: () => { },
	Uninstall: () => { },
	Load: (stat) => {
		username = stat.username
	},
	Unload: () => { },

	interfaces: {
		config: {
			GetData: () => ({
				AIsource: AIsource?.filename || '',
				chardata,
			}),
			SetData: async (data) => {
				if (data.chardata) {
					chardata = data.chardata
					saveJsonFile(charjson, chardata)
				}
				if (data.AIsource) AIsource = await loadAIsource(username, data.AIsource)
			}
		},
		chat: {
			GetGreeting: (arg, index) => {
				const greetings = [chardata?.first_mes, ...chardata?.alternate_greetings ?? []].filter(x => x)
				if (index >= greetings.length) throw new Error('Invalid index')
				const result = evaluateMacros(greetings[index], {
					char: chardata.name,
					user: arg.UserCharname,
					model: AIsource?.filename,
					charVersion: chardata.character_version,
					char_version: chardata.character_version,
				})
				return {
					content: runRegex(chardata, result, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.markdownOnly && !e.promptOnly),
					content_for_show: runRegex(chardata, result, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.promptOnly)
				}
			},
			GetGroupGreeting: (arg, index) => {
				const greetings = [...new Set([...chardata?.extensions?.group_greetings ?? [], ...chardata?.group_only_greetings ?? []].filter(x => x))]
				if (index >= greetings.length) throw new Error('Invalid index')
				const result = evaluateMacros(greetings[index], {
					char: chardata.name,
					user: arg.UserCharname,
					model: AIsource?.filename,
					charVersion: chardata.character_version,
					char_version: chardata.character_version,
				})
				return {
					content: runRegex(chardata, result, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.markdownOnly && !e.promptOnly),
					content_for_show: runRegex(chardata, result, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.promptOnly)
				}
			},
			GetPrompt: (arg, prompt_struct, detail_level) => {
				return promptBuilder(arg, chardata, AIsource?.filename)
			},
			// no GetPromptForOther, ST card does not support it
			GetReply: async (arg) => {
				if (!AIsource) return {
					content: 'this character does not have an AI source, set the AI source first',
				}
				const reply = await AIsource?.StructCall?.(await buildPromptStruct(arg)) ?? ''
				return {
					content: runRegex(chardata, reply, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.markdownOnly && !e.promptOnly),
					content_for_show: runRegex(chardata, reply, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.promptOnly)
				}
			},
			GetReplyFequency: async (arg) => {
				if (chardata.extensions.talkativeness) return Number(chardata.extensions.talkativeness) * 2
				return 1
			},
			MessageEdit: (arg) => {
				return {
					...arg.edited,
					content: runRegex(chardata, arg.edited.content, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.markdownOnly && !e.promptOnly && (e.runOnEdit ?? true)),
					content_for_show: runRegex(chardata, arg.edited.content, e => e.placement.includes(regex_placement.AI_OUTPUT) && !e.promptOnly && (e.runOnEdit ?? true)),
				}
			}
		}
	}
}
