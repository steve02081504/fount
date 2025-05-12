/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

import { structPromptToSingleNoChatLog } from '../../shells/chat/src/server/prompt_struct.mjs'
import { MarkovGenerator } from './MarkovGenerator.mjs'

const endToken = '<|endofres|>'

export default {
	interfaces: {
		AIsource: {
			GetConfigTemplate: async () => configTemplate,
			GetSource,
		}
	}
}

const configTemplate = {
	name: 'freeuse',
	model: 'claude-3-5-sonnet',
}

async function GetSource(config) {
	const generator = new MarkovGenerator({
		endToken,
	})
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
				content: generator.generate({
					prompt,
				}),
			}
		},
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			let prompt = structPromptToSingleNoChatLog(prompt_struct)
			prompt += `\
\n${prompt_struct.chat_log.map((item) => `${item.name}: ${item.content}\n${endToken}`).join('\n')}
${prompt_struct.Charname}: `
			return {
				content: generator.generate({
					prompt,
				}),
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
