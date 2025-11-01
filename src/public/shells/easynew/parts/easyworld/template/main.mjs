/** @typedef {import('../../../../../src/decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */

import path from 'node:path'

import { formatStr } from '../../../../../src/scripts/format.mjs'
import { loadJsonFile, saveJsonFile } from '../../../../../src/scripts/json_loader.mjs'

const partRoot = import.meta.dirname
const partJsonPath = path.join(partRoot, 'partdata.json')

/** @type {any} */
let partData = await loadJsonFile(partJsonPath)

const info = {}

/**
 * 更新部件信息。
 */
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

	/**
	 * 初始化。
	 * @param {any} stat - 状态。
	 */
	async Init(stat) { },
	/**
	 * 加载。
	 * @param {any} stat - 状态。
	 */
	async Load(stat) { },
	/**
	 * 卸载。
	 * @param {any} reason - 原因。
	 */
	async Unload(reason) { },
	/**
	 * 卸载。
	 * @param {any} reason - 原因。
	 * @param {any} from - 来源。
	 */
	async Uninstall(reason, from) { },

	interfaces: {
		config: {
			/**
			 * 获取数据。
			 * @returns {Promise<any>} - 数据。
			 */
			async GetData() {
				return { partData }
			},
			/**
			 * 设置数据。
			 * @param {any} data - 数据。
			 */
			async SetData(data) {
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
			 * @param {any} args - 参数。
			 * @returns {Promise<any>} - 提示。
			 */
			async GetPrompt(args) {
				if (!partData.prompt) return {
					text: [],
					additional_chat_log: [],
					extension: {},
				}
				const context = {
					char: { name: args.Charname },
					user: { name: args.UserCharname },
					args,
				}
				return {
					text: [{
						content: await formatStr(partData.prompt, context),
						description: '',
						important: 0,
					}],
					additional_chat_log: [],
					extension: {},
				}
			},
			/**
			 * 获取问候语。
			 * @param {any} args - 参数。
			 * @param {number} index - 索引。
			 * @returns {Promise<any>} - 问候语。
			 */
			async GetGreeting(args, index) {
				if (!partData.greeting) return null
				const context = {
					char: { name: args.Charname },
					user: { name:args.UserCharname },
					args,
					index,
				}
				return { content: await formatStr(partData.greeting, context) }
			},
		},
	},
}
