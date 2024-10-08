import { GoogleGenerativeAI } from '@google/generative-ai'
import { structPromptToSingleNoChatLog } from '../../shells/chat/src/server/prompt_struct.mjs'
/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */

export default async (config) => {
	let genAI = new GoogleGenerativeAI(config.apikey)
	let model = genAI.getGenerativeModel({ model: config.model })
	/** @type {AIsource_t} */
	let result = {
		info: {
			'': {
				avatar: '',
				name: 'gemini',
				description: 'gemini',
				description_markdown: 'gemini',
				version: '0.0.0',
				author: 'steve02081504',
				homepage: '',
				tags: ['Google'],
			}
		},
		is_paid: false,
		extension: {},

		Unload: () => { },
		Call: async (prompt) => {
			const result = await model.generateContent(prompt)
			return result.response.text()
		},
		StructCall: async (prompt_struct) => {
			let system_prompt = structPromptToSingleNoChatLog(prompt_struct)
			let request = {
				systemInstruction: system_prompt,
				contents: []
			}
			prompt_struct.chat_log.forEach((chatLogEntry) => {
				request.contents.push({
					role: chatLogEntry.role === 'user' ? 'user' : 'model',
					parts: [{ text: chatLogEntry.name + ':\n' + chatLogEntry.content }]
				})
			})

			let result = await model.generateContent(request)
			let text = result.response.text()
			if (text.split('\n')[0].endsWith(':')) {
				text = text.split('\n').slice(1).join('\n')
			}

			return text
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
