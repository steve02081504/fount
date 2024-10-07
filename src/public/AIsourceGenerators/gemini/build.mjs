import { GoogleGenerativeAI } from '@google/generative-ai'
import { structPromptToSingleNoChatLog } from '../../shells/chat/src/server/prompt_struct.mjs'
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

export default async (config) => {
	console.log(config)
	let genAI = new GoogleGenerativeAI(config.apikey)
	let model = genAI.getGenerativeModel({ model: config.model })
	return {
		avatar: '',
		name: 'gemini',
		description: 'gemini',
		description_markdown: 'gemini',
		is_paid: false,
		version: '0.0.0',
		author: 'steve02081504',
		homepage: '',
		tags: ['Google'],
		extension: {},

		Unload: () => {},
		Call: async (prompt) => {
			const result = await model.generateContent(prompt)
			return result.response.text()
		},
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			let system_prompt = structPromptToSingleNoChatLog(prompt_struct)
			let request = {
				systemInstruction: system_prompt,
				contents: []
			}
			prompt_struct.chat_log.forEach((chatLogEntry) => {
				request.contents.push({
					role: chatLogEntry.role === 'user' ? 'user' : 'model',
					parts: [{ text: chatLogEntry.charName + ': ' + chatLogEntry.content }]
				})
			})

			let result = await model.generateContent(request)
			return result.response.text()
		},
		Tokenizer: {
			free: () => 0,
			encode: (prompt) => prompt,
			decode: (tokens) => tokens,
			decode_single: (token) => token,
			get_token_count: (prompt) => model.countTokens(prompt)
		}
	}
}
