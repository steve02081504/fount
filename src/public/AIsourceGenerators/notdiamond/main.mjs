import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/server/prompt_struct.mjs'
import { escapeRegExp } from '../../../../src/scripts/escape.mjs'
import { NotDiamond } from './notdiamond.mjs'
/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

export default {
	GetConfigTemplate: async () => {
		return {
			name: 'notdiamond-gpt',
			email: '',
			password: '',
			model: 'gpt-3.5-turbo',
			convert_config: {
				roleReminding: true
			}
		}
	},
	GetSource: async (config) => {
		const notDiamond = new NotDiamond({
			email: config.email,
			password: config.password,
		})
		async function callBase(messages) {
			const result = await notDiamond.create({
				messages,
				model: config.model
			})
			if ('detail' in result) throw result.detail
			return result.content
		}
		/** @type {AIsource_t} */
		const result = {
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
				return {
					content: result,
				}
			},
			StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
				const messages = []
				margeStructPromptChatLog(prompt_struct).forEach((chatLogEntry) => {
					messages.push({
						role: chatLogEntry.role === 'user' ? 'user' : chatLogEntry.role === 'system' ? 'system' : 'assistant',
						content: chatLogEntry.name + ':\n' + chatLogEntry.content
					})
				})

				const system_prompt = structPromptToSingleNoChatLog(prompt_struct)
				messages.splice(Math.max(messages.length - 10, 0), 0, {
					role: 'system',
					content: system_prompt
				})

				if (config.convert_config?.roleReminding ?? true) {
					const isMutiChar = new Set([...prompt_struct.chat_log.map((chatLogEntry) => chatLogEntry.name).filter(Boolean)]).size > 2
					if (isMutiChar)
						messages.push({
							role: 'system',
							content: `现在请以${prompt_struct.Charname}的身份续写对话。`
						})
				}

				let text = await callBase(messages)

				{
					text = text.split('\n')
					const base_reg = `^((|${[...new Set([
						prompt_struct.Charname,
						...prompt_struct.chat_log.map((chatLogEntry) => chatLogEntry.name),
					])].filter(Boolean).map(escapeRegExp).concat([
						...(prompt_struct.alternative_charnames || []).map(Object).map(
							(stringOrReg) => {
								if (stringOrReg instanceof String) return escapeRegExp(stringOrReg)
								return stringOrReg.source
							}
						),
					].filter(Boolean)).join('|')})[^\\n：:]*)(:|：)\\s*`
					let reg = new RegExp(`${base_reg}$`, 'i')
					while (text[0].trim().match(reg)) text.shift()
					reg = new RegExp(`${base_reg}`, 'i')
					text[0] = text[0].replace(reg, '')
					text = text.join('\n')
				}

				return {
					content: text,
				}
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
