import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/server/prompt_struct.mjs'
/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

export default {
	GetSource: async (config) => {
		/** @type {AIsource_t} */
		let result = {
			info: {
				'': {
					avatar: '',
					name: config.name || config.model,
					description: 'proxy',
					description_markdown: 'proxy',
					version: '0.0.0',
					author: 'steve02081504',
					homepage: '',
					tags: ['proxy'],
				}
			},
			is_paid: false,
			extension: {},

			Unload: () => { },
			Call: async (prompt) => {
				const result = await fetch(config.url, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						model: config.model,
						messages: [
							{
								role: "system",
								content: prompt
							}
						]
					})
				})

				if (!result.ok)
					throw result

				return result.json().choices[0].message.content
			},
			StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
				let system_prompt = structPromptToSingleNoChatLog(prompt_struct)
				let request = {
					model: config.model,
					messages: [{
						role: 'system',
						content: system_prompt
					}]
				}
				margeStructPromptChatLog(prompt_struct).forEach((chatLogEntry) => {
					request.messages.push({
						role: chatLogEntry.role === 'user' ? 'user' : chatLogEntry.role === 'system' ? 'system' : 'assistant',
						content: chatLogEntry.name + ':\n' + chatLogEntry.content
					})
				})

				let result = await fetch(config.url, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify(request)
				})

				if (!result.ok)
					throw result

				let text = result.json().choices[0].message.content
				if (text.match(new RegExp(`^${prompt_struct.Charname}(:|：)\n`, 'ig')))
					text = text.split('\n').slice(1).join('\n')

				return text
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
