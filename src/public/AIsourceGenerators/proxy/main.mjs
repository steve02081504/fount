import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/server/prompt_struct.mjs'
/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

export default {
	GetSource: async (config) => {
		/** @type {AIsource_t} */
		let result = {
			type: 'text-chat',
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
						'Content-Type': 'application/json',
						'Authorization': config.apikey ? 'Bearer ' + config.apikey : undefined
					},
					body: JSON.stringify({
						model: config.model,
						messages: [
							{
								role: "system",
								content: prompt
							}
						],
						stream: false,
						...config.model_arguments || {
							temperature: 1,
							max_tokens: 800,
							n: 1
						},
					})
				})

				if (!result.ok)
					throw result

				let text = await result.text()
				if (text.startsWith('data:'))
					text = text.split('\n').filter((line) => line.startsWith('data:')).map(line => line.slice(5).trim()).map(JSON.parse).map((json) => json.choices[0].delta.content).join('')
				else {
					let json
					try { json = JSON.parse(text) }
					catch { json = await result.json() }
					text = json.choices[0].message.content
				}

				return text
			},
			StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
				let request = {
					model: config.model,
					messages: [],
					stream: false,
					...config.model_arguments || {
						temperature: 1,
						max_tokens: 800,
						n: 1
					},
				}
				margeStructPromptChatLog(prompt_struct).forEach((chatLogEntry) => {
					request.messages.push({
						role: chatLogEntry.role === 'user' ? 'user' : chatLogEntry.role === 'system' ? 'system' : 'assistant',
						content: chatLogEntry.name + ':\n' + chatLogEntry.content
					})
				})

				let system_prompt = structPromptToSingleNoChatLog(prompt_struct)
				request.messages.splice(Math.max(request.messages.length - 10, 0), 0, {
					role: 'system',
					content: system_prompt
				})

				let result = await fetch(config.url, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Authorization': config.apikey ? 'Bearer ' + config.apikey : undefined
					},
					body: JSON.stringify(request)
				})

				if (!result.ok)
					throw result

				let text = await result.text()
				if (text.startsWith('data:'))
					text = text.split('\n').filter((line) => line.startsWith('data:')).map(line => line.slice(5).trim()).map(JSON.parse).map((json) => json.choices[0].delta.content).join('')
				else {
					let json
					try { json = JSON.parse(text) }
					catch { json = await result.json() }
					text = json.choices[0].message.content
				}

				if (text.match(new RegExp(`^(|${prompt_struct.Charname}[^\\n]*)(:|：)*\\n`, 'ig')))
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
