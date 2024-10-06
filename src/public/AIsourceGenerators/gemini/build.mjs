import { GoogleGenerativeAI } from '@google/generative-ai'

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
		Tokenizer: {
			free: () => 0,
			encode: (prompt) => prompt,
			decode: (tokens) => tokens,
			decode_single: (token) => token,
			get_token_count: (prompt) => model.countTokens(prompt)
		}
	}
}
