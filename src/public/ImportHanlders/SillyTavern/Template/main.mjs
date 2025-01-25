import fs from 'node:fs'
import path from 'node:path'
import { loadAIsource } from '../../../../../src/server/managers/AIsources_manager.mjs'
import { saveJsonFile } from '../../../../../src/scripts/json_loader.mjs'
import { promptBuilder } from '../../../../../src/public/ImportHanlders/SillyTavern/engine/prompt_builder.mjs'
import { buildPromptStruct } from '../../../../../src/public/shells/chat/src/server/prompt_struct.mjs'
import { runRegex } from '../../../../../src/public/ImportHanlders/SillyTavern/engine/regex.mjs'
import { regex_placement } from '../../../../../src/public/ImportHanlders/SillyTavern/engine/charData.mjs'
import { evaluateMacros } from '../../../../../src/public/ImportHanlders/SillyTavern/engine/marco.mjs'

/** @typedef {import('../../../../../src/decl/charAPI.ts').charAPI_t} charAPI_t */
/** @typedef {import('../../../../../src/decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../../../src/public/ImportHanlders/SillyTavern/engine/charData.mjs').v2CharData} chardata_t */

/** @type {AIsource_t} */
let AIsource = null

let username = ''

let chardir = import.meta.dirname
let charurl = `/chars/${path.basename(chardir)}`
let charjson = path.join(chardir, 'chardata.json')

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
			homepage: '',
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
				AIsource: AIsource.filename,
				chardata,
			}),
			SetData: (data) => {
				if (data.chardata) {
					chardata = data.chardata
					saveJsonFile(charjson, chardata)
				}
				if (data.AIsource) AIsource = loadAIsource(username, data.AIsource)
			}
		},
		chat: {
			GetGreeting: (arg, index) => {
				let greetings = [chardata?.first_mes, ...chardata?.alternate_greetings ?? []].filter(x => x)
				if (index >= greetings.length) throw new Error('Invalid index')
				return {
					content: evaluateMacros(greetings[index], {
						char: chardata.name,
						user: arg.UserCharname,
						model: AIsource?.filename,
						charVersion: chardata.character_version,
						char_version: chardata.character_version,
					})
				}
			},
			GetGroupGreeting: (arg, index) => {
				let greetings = [...new Set([...chardata?.extensions?.group_greetings ?? [], ...chardata?.group_only_greetings ?? []].filter(x => x))]
				if (index >= greetings.length) throw new Error('Invalid index')
				return {
					content: evaluateMacros(greetings[index], {
						char: chardata.name,
						user: arg.UserCharname,
						model: AIsource?.filename,
						charVersion: chardata.character_version,
						char_version: chardata.character_version,
					})
				}
			},
			GetPrompt: (arg, prompt_struct, detail_level) => {
				return promptBuilder(arg, chardata, AIsource?.filename)
			},
			// no GetPromptForOther, ST card does not support it
			GetReply: async (arg) => {
				let reply = await AIsource?.Call?.(await buildPromptStruct(arg)) ?? ''
				return {
					content: runRegex(chardata, regex_placement.AI_OUTPUT, reply),
					content_for_edit: reply
				}
			},
			MessageEdit: (arg) => {
				return {
					...arg.edited,
					content: runRegex(chardata, regex_placement.AI_OUTPUT, arg.edited.content)
				}
			}
		}
	}
}
