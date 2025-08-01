/** @typedef {import('../../../../../src/decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */

import { loadJsonFile, saveJsonFile } from '../../../../../src/scripts/json_loader.mjs'
import path from 'node:path'
import { evaluateTemplate } from '../../../../../src/public/shells/easynew/src/server/template_engine.mjs'

const partRoot = import.meta.dirname
const partJsonPath = path.join(partRoot, 'partdata.json')

/** @type {any} */
let partData = await loadJsonFile(partJsonPath)

const info = {}

function updateInfo() {
	const worldUrl = `/worlds/${encodeURIComponent(partData.name)}`
	info[''] = {
		name: partData.name,
		avatar: partData.has_avatar ? `${worldUrl}/image.png` : '',
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

/** @type {WorldAPI_t} */
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
				if (!partData.prompt) return {
					text: [],
					additional_chat_log: [],
					extension: {},
				}
				const context = {
					char: { name: args.Charname },
					user: { name: args.UserCharname },
					args,
					prompt_struct,
					detail_level,
				}
				return {
					text: [{
						content: await evaluateTemplate(partData.prompt, context),
						description: '',
						important: 0,
					}],
					additional_chat_log: [],
					extension: {},
				}
			},
			async GetGreeting(arg, index) {
				if (!partData.greeting) return null
				const context = {
					char: { name: arg.Charname },
					user: { name: arg.UserCharname },
					args,
					index,
				}
				return { content: await evaluateTemplate(partData.greeting, context) }
			},
		},
	},
}
