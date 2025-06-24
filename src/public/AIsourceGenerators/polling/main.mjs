/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

import { loadAIsourceFromNameOrConfigData } from '../../../server/managers/AIsource_manager.mjs'


export default {
	interfaces: {
		AIsource: {
			GetConfigTemplate: async () => configTemplate,
			GetSource,
		}
	}
}

const configTemplate = {
	name: 'polling array',
	provider: 'unknown',
	sources: [
		'source name1',
		'source name2',
		{
			generator: 'some generator',
			config: {
				model_name: 'lol',
				other_datas: 'lol'
			}
		}
	],
}
async function GetSource(config, { username, SaveConfig }) {
	let index = -1
	const unnamedSources = []
	const sources = await Promise.all(config.sources.map(source => loadAIsourceFromNameOrConfigData(username, source, unnamedSources, {
		SaveConfig
	})))
	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: {
			'': {
				avatar: '',
				name: config.name,
				provider: config.provider || 'unknown',
				description: 'polling',
				description_markdown: 'polling',
				version: '0.0.0',
				author: 'steve02081504',
				home_page: '',
				tags: ['polling'],
			}
		},
		is_paid: false,
		extension: {},

		Unload: () => Promise.all(unnamedSources.map(source => source.Unload())),
		Call: async (prompt) => {
			if (sources.length === 0) throw new Error('no source selected')
			while (true) try {
				index++
				index %= config.sources.length
				return await sources[index].Call(prompt)
			}
			catch (e) {
				console.error(e)
			}
		},
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			if (sources.length === 0) throw new Error('no source selected')
			while (true) try {
				index++
				index %= config.sources.length
				return await sources[index].StructCall(prompt_struct)
			}
			catch (e) {
				console.error(e)
			}
		},
		tokenizer: {
			free: () => 0,
			encode: (prompt) => prompt,
			decode: (tokens) => tokens,
			decode_single: (token) => token,
			get_token_count: (prompt) => prompt.length
		}
	}
	return result
}
