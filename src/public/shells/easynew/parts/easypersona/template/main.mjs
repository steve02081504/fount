/** @typedef {import('../../../../../src/decl/userAPI.ts').UserAPI_t} UserAPI_t */

import path from 'node:path'

import { formatStr } from '../../../../../src/scripts/format.mjs'
import { loadJsonFile, saveJsonFile } from '../../../../../src/scripts/json_loader.mjs'

const partRoot = import.meta.dirname
const partJsonPath = path.join(partRoot, 'partdata.json')

/** @type {any} */
let partData = await loadJsonFile(partJsonPath)

const info = {}

function updateInfo() {
	const personaUrl = `/personas/${encodeURIComponent(partData.name)}`
	info[''] = {
		name: partData.name,
		avatar: partData.has_avatar ? `${personaUrl}/image.png` : '',
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

/** @type {UserAPI_t} */
export default {
	info,

	async Init(stat) { },
	async Load(stat) { },
	async Unload(reason) { },
	async Uninstall(reason, from) { },

	interfaces: {
		config: {
			async GetData() {
				return { partData }
			},
			async SetData(data) {
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

				let content = ''
				if (partData.user_name) content += `The user's name is ${await formatStr(partData.user_name, context)}.\n`
				if (partData.appearance) content += `The user's appearance: ${await formatStr(partData.appearance, context)}\n`
				if (partData.personality) content += `The user's personality: ${await formatStr(partData.personality, context)}\n`

				if (!content) return {
					text: [],
					additional_chat_log: [],
					extension: {},
				}

				return {
					text: [{
						content: content.trim(),
						description: '',
						important: 0,
					}],
					additional_chat_log: [],
					extension: {},
				}
			},
		},
	},
}
