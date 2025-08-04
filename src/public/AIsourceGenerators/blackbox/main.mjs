import { with_timeout } from '../../../scripts/await_timeout.mjs'
import { escapeRegExp } from '../../../scripts/escape.mjs'
import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/server/prompt_struct.mjs'

import { BlackboxAI } from './blackbox.mjs'
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
	name: 'Blackbox',
	model: 'claude-3-5-sonnet',
	timeout: 10000,
	convert_config: {
		roleReminding: true
	}
}
async function GetSource(config) {
	const blackbox = new BlackboxAI(config)
	/** @type {AIsource_t} */
	const result = {
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
				home_page: '',
				tags: ['Blackbox'],
			}
		},
		is_paid: false,
		extension: {},

		Unload: () => { },
		Call: async (prompt) => {
			const result = await with_timeout(config.timeout || 10000, blackbox.call(prompt, config.model))
			return {
				content: result,
			}
		},
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			const messages = []
			margeStructPromptChatLog(prompt_struct).forEach((chatLogEntry) => {
				const uid = Math.random().toString(36).slice(2, 10)
				messages.push({
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

			const system_prompt = structPromptToSingleNoChatLog(prompt_struct)
			if (config.system_prompt_at_depth ?? 10)
				messages.splice(Math.max(messages.length - (config.system_prompt_at_depth ?? 10), 0), 0, {
					role: 'system',
					content: system_prompt
				})
			else
				messages.unshift({
					role: 'system',
					content: system_prompt
				})

			if (config.convert_config?.roleReminding ?? true) {
				const isMutiChar = new Set(prompt_struct.chat_log.map((chatLogEntry) => chatLogEntry.name).filter(Boolean)).size > 2
				if (isMutiChar)
					messages.push({
						role: 'system',
						content: `现在请以${prompt_struct.Charname}的身份续写对话。`
					})
			}

			let text = await with_timeout(config.timeout || 10000, blackbox.call(messages, config.model))

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

			return {
				content: text,
			}
		},
		tokenizer: {
			free: () => 0,
			encode: (prompt) => prompt,
			decode: (tokens) => tokens,
			decode_single: (token) => token,
			get_token_count: (prompt) => blackbox.countTokens(prompt)
		}
	}

	return result
}
