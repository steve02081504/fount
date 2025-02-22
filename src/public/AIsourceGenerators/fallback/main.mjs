/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

import { loadAIsourceFromNameOrConfigData } from '../../../server/managers/AIsources_manager.mjs'

export default {
	GetSource: async (config, { username }) => {
		const sources = await Promise.all(config.sources.map(source => loadAIsourceFromNameOrConfigData(username, source)))
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
}
