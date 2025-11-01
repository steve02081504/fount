import { escapeRegExp } from '../../../scripts/escape.mjs'
import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/prompt_struct.mjs'

import { NotDiamond } from './notdiamond.mjs'
/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

/**
 *
 */
export default {
	interfaces: {
		AIsource: {
			/**
			 *
			 */
			GetConfigTemplate: async () => configTemplate,
			GetSource,
		}
	}
}

const configTemplate = {
	name: 'notdiamond-gpt',
	email: '',
	password: '',
	model: 'gpt-3.5-turbo',
	convert_config: {
		roleReminding: true
	}
}

/**
 *
 * @param config
 */
async function GetSource(config) {
	const notDiamond = new NotDiamond({
		email: config.email,
		password: config.password,
	})
	/**
	 *
	 * @param messages
	 */
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
				home_page: '',
				tags: ['NotDiamond'],
			}
		},
		is_paid: false,
		extension: {},

		/**
		 *
		 * @param prompt
		 */
		Call: async prompt => {
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
		/**
		 *
		 * @param prompt_struct
		 */
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			const messages = []
			margeStructPromptChatLog(prompt_struct).forEach(chatLogEntry => {
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
			messages.splice(Math.max(messages.length - 10, 0), 0, {
				role: 'system',
				content: system_prompt
			})

			if (config.convert_config?.roleReminding ?? true) {
				const isMutiChar = new Set(prompt_struct.chat_log.map(chatLogEntry => chatLogEntry.name).filter(Boolean)).size > 2
				if (isMutiChar)
					messages.push({
						role: 'system',
						content: `现在请以${prompt_struct.Charname}的身份续写对话。`
					})
			}

			let text = await callBase(messages)

			if (text.match(/<\/sender>\s*<content>/))
				text = text.match(/<\/sender>\s*<content>([\S\s]*)<\/content>/)[1].split(new RegExp(
					`(${(prompt_struct.alternative_charnames || []).map(Object).map(
						stringOrReg => {
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
			/**
			 *
			 */
			free: () => 0,
			/**
			 *
			 * @param prompt
			 */
			encode: prompt => prompt,
			/**
			 *
			 * @param tokens
			 */
			decode: tokens => tokens,
			/**
			 *
			 * @param token
			 */
			decode_single: token => token,
			/**
			 *
			 * @param prompt
			 */
			get_token_count: prompt => notDiamond.countTokens(prompt)
		}
	}

	return result
}
