/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

import { loadAIsourceFromNameOrConfigData } from '../../../server/managers/AIsources_manager.mjs'

export default {
	interfaces: {
		AIsource: {
			GetConfigTemplate: async () => configTemplate,
			GetSource,
		}
	}
}

const configTemplate = {
	name: 'fallback array',
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
	const sources = await Promise.all(config.sources.map((source) => loadAIsourceFromNameOrConfigData(username, source, {
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
				description: 'fallback',
				description_markdown: 'fallback',
				version: '0.0.0',
				author: 'steve02081504',
				homepage: '',
				tags: ['fallback'],
			}
		},
		is_paid: false,
		extension: {},

		Unload: () => { },
		Call: async (prompt) => {
			if (sources.length === 0) throw new Error('no source selected')
			let index = 0
			while (true) try {
				return await sources[index].Call(prompt)
			}
			catch (e) {
				index++
				if (index >= config.sources.length) throw new Error('all sources failed')
				console.error(e)
			}
		},
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			if (sources.length === 0) throw new Error('no source selected')
			let index = 0
			while (true) try {
				return await sources[index].StructCall(prompt_struct)
			}
			catch (e) {
				index++
				if (index >= config.sources.length) throw new Error('all sources failed')
				console.error(e)
			}
		},
		Tokenizer: {
			free: () => 0,
			encode: (prompt) => prompt,
			decode: (tokens) => tokens,
			decode_single: (token) => token,
			get_token_count: (prompt) => prompt.length
		}
	}
	return result
}
