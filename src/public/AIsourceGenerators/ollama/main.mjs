import fs from 'node:fs'
import path from 'node:path'

import { Ollama } from 'npm:ollama'

import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/prompt_struct.mjs'

/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

export default {
	interfaces: {
		AIsource: {
			GetConfigDisplayContent: async () => ({
				js: fs.readFileSync(path.join(import.meta.dirname, 'display.mjs'), 'utf-8')
			}),
			GetConfigTemplate: async () => configTemplate,
			GetSource,
		}
	}
}

const configTemplate = {
	name: 'ollama',
	host: 'http://127.0.0.1:11434',
	model: 'llama3',
	model_arguments: {
		temperature: 1,
		num_predict: -1, // -1 for infinite
	},
	system_prompt_at_depth: 10,
	convert_config: {
		roleReminding: true
	}
}

async function GetSource(config) {
	const ollama = new Ollama({ host: config.host })

	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: {
			'': {
				avatar: '',
				name: config.name || config.model,
				provider: 'Ollama',
				description: 'Ollama',
				description_markdown: 'Locally running language models via Ollama.',
				version: '0.0.1',
				author: 'steve02081504',
				home_page: 'https://github.com/ollama/ollama',
				tags: ['ollama', 'local'],
			}
		},
		is_paid: false,
		extension: {},

		Call: async prompt => {
			const response = await ollama.generate({
				model: config.model,
				prompt,
				stream: false,
				options: config.model_arguments
			})
			return {
				content: response.response,
			}
		},
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			const messages = margeStructPromptChatLog(prompt_struct).map(chatLogEntry => {
				const images = (chatLogEntry.files || [])
					.filter(file => file.mime_type && file.mime_type.startsWith('image/'))
					.map(file => file.buffer.toString('base64'))

				/** @type {{role: 'user'|'assistant'|'system', content: string, images?: string[]}} */
				const message = {
					role: chatLogEntry.role === 'user' ? 'user' : chatLogEntry.role === 'system' ? 'system' : 'assistant',
					content: chatLogEntry.content,
				}
				if (images.length > 0)
					message.images = images

				return message
			})

			const system_prompt = structPromptToSingleNoChatLog(prompt_struct)
			if (system_prompt) {
				const systemMessage = {
					role: 'system',
					content: system_prompt
				}
				if (config.system_prompt_at_depth && config.system_prompt_at_depth < messages.length)
					messages.splice(Math.max(messages.length - config.system_prompt_at_depth, 0), 0, systemMessage)
				else
					messages.unshift(systemMessage)

			}


			if (config.convert_config?.roleReminding ?? true) {
				const isMutiChar = new Set(prompt_struct.chat_log.map(chatLogEntry => chatLogEntry.name).filter(Boolean)).size > 2
				if (isMutiChar)
					messages.push({
						role: 'system',
						content: `Now, please continue the conversation as ${prompt_struct.Charname}.`
					})
			}

			let response_text = ''
			const response_files = []

			const response = await ollama.chat({
				model: config.model,
				messages,
				stream: false,
				options: config.model_arguments
			})
			response_text = response.message.content

			return {
				content: response_text,
				files: response_files
			}
		},
		tokenizer: {
			free: _ => 0,
			encode: prompt => prompt,
			decode: tokens => tokens,
			decode_single: token => token,
			get_token_count: async prompt => {
				if (!prompt) return 0
				try {
					const response = await ollama.encode({ model: config.model, prompt })
					return response.tokens.length
				} catch (error) {
					console.warn('Failed to get token count from Ollama API, falling back to character count.', error)
					return (prompt?.length ?? 0) / 4
				}
			}
		}
	}
	return result
}
