import { GoogleGenerativeAI } from 'npm:@google/generative-ai'
import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/server/prompt_struct.mjs'
/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

export default {
	GetSource: async (config) => {
		let genAI = new GoogleGenerativeAI(config.apikey)
		//fileManager is unable to upload buffer, for now we just use inlineData
		// let fileManager = new GoogleAIFileManager(config.apikey)
		let model = genAI.getGenerativeModel({
			safetySettings: [
				{
					category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
					threshold: 'BLOCK_NONE'
				},
				{
					category: 'HARM_CATEGORY_HATE_SPEECH',
					threshold: 'BLOCK_NONE'
				},
				{
					category: 'HARM_CATEGORY_HARASSMENT',
					threshold: 'BLOCK_NONE'
				},
				{
					category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
					threshold: 'BLOCK_NONE'
				},
				{
					category: 'HARM_CATEGORY_CIVIC_INTEGRITY',
					threshold: 'BLOCK_NONE'
				}
			],
			model: config.model
		})
		/** @type {AIsource_t} */
		let result = {
			type: 'text-chat',
			info: {
				'': {
					avatar: '',
					name: config.name || config.model,
					provider: 'gemini',
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
			StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
				let system_prompt = structPromptToSingleNoChatLog(prompt_struct)
				let request = {
					contents: [{
						role: 'user',
						parts: [{ text: `\
我需要你进行以下扮演：
${system_prompt}
如果你理解了，请回复“我理解了”。
` }]
					},
					{
						role: 'model',
						parts: [{ text: '我理解了' }]
					}]
				}
				margeStructPromptChatLog(prompt_struct).forEach((chatLogEntry) => {
					request.contents.push({
						role: chatLogEntry.role === 'user' ? 'user' : 'model',
						parts: [
							{ text: chatLogEntry.name + ':\n' + chatLogEntry.content },
							...(chatLogEntry.files || []).map(file => ({ inlineData: { data: file.buffer.toString("base64"), mimeType: file.mimeType } }))
						],
					})
				})
				request.contents = request.contents.concat([
					{
						role: 'user',
						parts: [{ text: `暂停扮演，请你重新整理并回复你的目标，随后继续扮演。` }]
					},
					{
						role: 'model',
						parts: [{ text: `好的。我的目标是深入理解并扮演角色${prompt_struct.Charname}，我会在接下来的回复中严格遵循角色设定。\n接下来我会继续扮演。` }]
					}
				])

				let result = await model.generateContent(request)
				let text = result.response.text()
				if (text.match(new RegExp(`^(|${prompt_struct.Charname}[^\\n]*)(:|：)*\\n`, 'ig')))
					text = text.split('\n').slice(1).join('\n')

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
}
