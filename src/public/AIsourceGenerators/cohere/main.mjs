import { CohereClientV2 } from 'npm:cohere-ai'
import { escapeRegExp } from '../../../../src/scripts/escape.mjs'
import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/server/prompt_struct.mjs'
/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

export default {
	GetConfigTemplate: async () => {
		return {
			name: 'cohere-command-r-plus',
			model: 'command-r-plus',
			apikey: '',
		}
	},
	GetSource: async (config) => {
		const cohere = new CohereClientV2({
			token: config.apikey,
		})
		/** @type {AIsource_t} */
		const result = {
			type: 'text-chat',
			info: {
				'': {
					avatar: '',
					name: config.name || config.model,
					provider: 'cohere',
					description: 'cohere',
					description_markdown: 'cohere',
					version: '0.0.0',
					author: 'steve02081504',
					homepage: '',
					tags: ['cohere'],
				}
			},
			is_paid: false,
			extension: {},

			Unload: () => { },
			Call: async (prompt) => {
				const result = await cohere.generate({ prompt, model: config.model })
				return {
					content: result.generations.map((generation) => generation.text).join('\n')
				}
			},
			StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
				const system_prompt = structPromptToSingleNoChatLog(prompt_struct)
				const request = {
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

				if (config.roleReminding ?? true) {
					const isMutiChar = new Set([...prompt_struct.chat_log.map((chatLogEntry) => chatLogEntry.name)]).size > 2
					if (isMutiChar)
						request.messages.push({
							role: 'system',
							content: `现在请以${prompt_struct.Charname}的身份续写对话。`
						})
				}

				const result = await cohere.chat(request)
				let text = result?.message?.content?.map((message) => message?.text)?.filter((text) => text)?.join('\n')
				if (!text) throw result

				{
					text = text.split('\n')
					const base_reg = `^(|${[...new Set([
						prompt_struct.Charname,
						...prompt_struct.chat_log.map((chatLogEntry) => chatLogEntry.name),
					])].filter(Boolean).map(escapeRegExp).concat([
						...(prompt_struct.alternative_charnames || []).map(Object).map(
							(stringOrReg) => {
								if (stringOrReg instanceof String) return escapeRegExp(stringOrReg)
								return stringOrReg.source
							}
						),
					].filter(Boolean)).join('|')}[^\\n：:]*)(:|：)\\s*`
					let reg = new RegExp(`${base_reg}$`, 'i')
					while (text[0].trim().match(reg)) text.shift()
					reg = new RegExp(`${base_reg}`, 'i')
					text[0] = text[0].replace(reg, '')
					text = text.join('\n')
				}

				const removeduplicate = [...new Set(text.split('\n'))].join('\n')
				if (removeduplicate.length / text.length < 0.3)
					text = removeduplicate

				return {
					content: text
				}
			},
			Tokenizer: {
				free: () => 0,
				encode: (prompt) => cohere.tokenize({
					model: config.model,
					text: prompt
				}).then((result) => result.tokens),
				decode: (tokens) => cohere.detokenize({
					model: config.model,
					tokens
				}).then((result) => result.text),
				decode_single: (token) => cohere.detokenize({
					model: config.model,
					tokens: [token]
				}).then((result) => result.text),
				get_token_count: (prompt) => cohere.tokenize({
					model: config.model,
					text: prompt
				}).then((result) => result.tokens.length)
			}
		}

		return result
	}
}
