import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/server/prompt_struct.mjs'
import { NotDiamond } from './notdiamond.mjs'
/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

export default {
	GetSource: async (config) => {
		const notDiamond = new NotDiamond({
			email: config.email,
			password: config.password,
		})
		async function callBase(messages) {
			let result = await notDiamond.create({
				messages,
				model: config.model
			})
			if ('detail' in result) throw result.detail
			return result.content
		}
		/** @type {AIsource_t} */
		let result = {
			type: 'text-chat',
			info: {
				'': {
					avatar: '',
					name: config.name || config.model,
					provider: 'notdiamond',
					description: 'notdiamond',
					description_markdown: 'notdiamond',
					version: '0.0.0',
					author: 'steve02081504',
					homepage: '',
					tags: ['NotDiamond'],
				}
			},
			is_paid: false,
			extension: {},

			Unload: () => { },
			Call: async (prompt) => {
				const result = await callBase([
					{
						role: 'system',
						content: prompt
					}
				])
				return result
			},
			StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
				let messages = []
				margeStructPromptChatLog(prompt_struct).forEach((chatLogEntry) => {
					messages.push({
						role: chatLogEntry.role === 'user' ? 'user' : chatLogEntry.role === 'system' ? 'system' : 'assistant',
						content: chatLogEntry.name + ':\n' + chatLogEntry.content
					})
				})

				let system_prompt = structPromptToSingleNoChatLog(prompt_struct)
				messages.splice(Math.max(messages.length - 10, 0), 0, {
					role: 'system',
					content: system_prompt
				})

				if (config.roleReminding ?? true) {
					let isMutiChar = new Set([...prompt_struct.chat_log.map((chatLogEntry) => chatLogEntry.name)]).size > 2
					if (isMutiChar)
						messages.push({
							role: 'system',
							content: `现在请以${prompt_struct.Charname}的身份续写对话。`
						})
				}

				let text = await callBase(messages)

				{
					text = text.split('\n')
					let reg = new RegExp(`^(|${prompt_struct.Charname}[^\\n]*)(:|：)*$`, 'i')
					while (text[0].trim().match(reg)) text.shift()
					text = text.join('\n')
				}

				return text
			},
			Tokenizer: {
				free: () => 0,
				encode: (prompt) => prompt,
				decode: (tokens) => tokens,
				decode_single: (token) => token,
				get_token_count: (prompt) => notDiamond.countTokens(prompt)
			}
		}

		return result
	}
}
