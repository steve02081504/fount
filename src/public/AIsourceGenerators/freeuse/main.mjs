/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

export default {
	GetConfigTemplate: async () => {
		return {
			name: 'freeuse',
			model: 'claude-3-5-sonnet',
		}
	},
	GetSource: async (config) => {
		/** @type {AIsource_t} */
		const result = {
			type: 'text-chat',
			info: {
				'': {
					avatar: '',
					name: config.name || config.model || 'freeuse',
					provider: 'freeuse',
					description: 'freeuse',
					description_markdown: 'freeuse',
					version: '0.0.0',
					author: 'steve02081504',
					homepage: '',
					tags: ['free'],
				}
			},
			is_paid: false,
			extension: {},

			Unload: () => { },
			Call: async (prompt) => {
				return {
					content: '好的，没问题。',
				}
			},
			StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
				return {
					content: '好的，没问题。',
				}
			},
			Tokenizer: {
				free: () => 0,
				encode: (prompt) => prompt,
				decode: (tokens) => tokens,
				decode_single: (token) => token,
				get_token_count: (prompt) => model.countTokens(prompt)
			}
		}

		return result
	}
}
