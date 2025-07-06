import { CohereClientV2 } from 'npm:cohere-ai'
import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/server/prompt_struct.mjs'
import { escapeRegExp } from '../../../scripts/escape.mjs'
/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

export default {
	interfaces: {
		AIsource: {
			GetConfigTemplate: async () => configTemplate,
			GetSource,
		}
	}
}

const configTemplate = {
	name: 'cohere-command-r-plus',
	model: 'command-r-plus',
	apikey: '',
	convert_config: {
		roleReminding: true
	}
}
async function GetSource(config) {
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
				home_page: '',
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
				const uid = Math.random().toString(36).slice(2, 10)
				request.messages.push({
					role: chatLogEntry.role === 'user' ? 'user' : chatLogEntry.role === 'system' ? 'system' : 'assistant',
					content: `\
<message "${uid}">
<sender>${chatLogEntry.name}</sender>
<content>
${chatLogEntry.content}
</content>
</message "${uid}">
`
				})
			})

			if (config.convert_config?.roleReminding ?? true) {
				const isMutiChar = new Set(prompt_struct.chat_log.map((chatLogEntry) => chatLogEntry.name).filter(Boolean)).size > 2
				if (isMutiChar)
					request.messages.push({
						role: 'system',
						content: `现在请以${prompt_struct.Charname}的身份续写对话。`
					})
			}

			const result = await cohere.chat(request)
			let text = result?.message?.content?.map((message) => message?.text)?.filter((text) => text)?.join('\n')
			if (!text) throw result

			if (text.match(/<\/sender>\s*<content>/))
				text = text.match(/<\/sender>\s*<content>([\S\s]*)<\/content>/)[1].split(new RegExp(
					`(${(prompt_struct.alternative_charnames || []).map(Object).map(
						(stringOrReg) => {
							if (stringOrReg instanceof String) return escapeRegExp(stringOrReg)
							return stringOrReg.source
						}
					).join('|')
					})\\s*<\\/sender>\\s*<content>`
				)).pop().split(/<\/content>\s*<\/message/).shift()
			if (text.match(/<\/content>\s*<\/message[^>]*>\s*$/))
				text = text.split(/<\/content>\s*<\/message[^>]*>\s*$/).shift()

			const removeduplicate = [...new Set(text.split('\n'))].join('\n')
			if (removeduplicate.length / text.length < 0.3)
				text = removeduplicate

			return {
				content: text
			}
		},
		tokenizer: {
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
