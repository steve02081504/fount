import { with_timeout } from "../../../scripts/await_timeout.mjs"
import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/server/prompt_struct.mjs'
import { BlackboxAI } from './blackbox.mjs'
/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

export default {
	GetSource: async (config) => {
		const blackbox = new BlackboxAI(config)
		/** @type {AIsource_t} */
		let result = {
			type: 'text-chat',
			info: {
				'': {
					avatar: '',
					name: config.name || config.model,
					provider: 'blackbox',
					description: 'Blackbox',
					description_markdown: 'Blackbox',
					version: '0.0.0',
					author: 'steve02081504',
					homepage: '',
					tags: ['Blackbox'],
				}
			},
			is_paid: false,
			extension: {},

			Unload: () => { },
			Call: async (prompt) => {
				const result = await with_timeout(config.timeout || 10000, blackbox.call(prompt, config.model))
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
				if (config.system_prompt_at_depth ?? 10)
					messages.splice(Math.max(messages.length - config.system_prompt_at_depth, 0), 0, {
						role: 'system',
						content: system_prompt
					})
				else
					messages.unshift({
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

				let text = await with_timeout(config.timeout || 10000, blackbox.call(messages, config.model))

				{
					text = text.split('\n')
					let base_reg = `^(|${prompt_struct.Charname}[^\\n：:]*)(:|：)\\s*`
					let reg = new RegExp(`${base_reg}$`, 'i')
					while (text[0].trim().match(reg)) text.shift()
					reg = new RegExp(`${base_reg}`, 'i')
					text[0] = text[0].replace(reg, '')
					text = text.join('\n')
				}

				return text
			},
			Tokenizer: {
				free: () => 0,
				encode: (prompt) => prompt,
				decode: (tokens) => tokens,
				decode_single: (token) => token,
				get_token_count: (prompt) => blackbox.countTokens(prompt)
			}
		}

		return result
	}
}
