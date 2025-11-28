
import { escapeRegExp } from '../../../scripts/escape.mjs'
import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/prompt_struct.mjs'

import info_dynamic from './info.dynamic.json' with { type: 'json' }
import info from './info.json' with { type: 'json' }
/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/AIsource.ts').AIsource_StructCall_options_t} AIsource_StructCall_options_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

/**
 * @type {import('../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	info,
	interfaces: {
		AIsource: {
			/**
			 * 获取此 AI 源的配置模板。
			 * @returns {Promise<object>} 配置模板。
			 */
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
/**
 * 获取 AI 源。
 * @param {object} config - 配置对象。
 * @returns {Promise<AIsource_t>} AI 源。
 */
async function GetSource(config) {
	const { CohereClient } = await import('npm:cohere-ai')
	const cohere = new CohereClient({
		token: config.apikey,
	})
	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: Object.fromEntries(Object.entries(structuredClone(info_dynamic)).map(([k, v]) => {
			v.name = config.name || config.model
			return [k, v]
		})),
		is_paid: false,
		extension: {},

		/**
		 * 调用 AI 源。
		 * @param {string} prompt - 要发送给 AI 的提示。
		 * @returns {Promise<{content: string}>} 来自 AI 的结果。
		 */
		Call: async prompt => {
			const result = await cohere.generate({ prompt, model: config.model })
			return {
				content: result.generations.map(generation => generation.text).join('\n')
			}
		},
		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @param {AIsource_StructCall_options_t} options
		 * @returns {Promise<{content: string}>} 来自 AI 的结果。
		 */
		StructCall: async (prompt_struct, { base_result, replyPreviewUpdater, signal }) => {
			return new Promise(async (resolve, reject) => {
				try {
					signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))

					const system_prompt = structPromptToSingleNoChatLog(prompt_struct)
					/** @type {import('npm:cohere-ai/api').ChatRequest} */
					const request = {
						model: config.model,
						chatHistory: [],
						message: '',
						preamble: system_prompt
					}

					const messages = margeStructPromptChatLog(prompt_struct).map(chatLogEntry => {
						const uid = Math.random().toString(36).slice(2, 10)
						const role = chatLogEntry.role === 'user' ? 'USER' : chatLogEntry.role === 'system' ? 'SYSTEM' : 'CHATBOT'
						const content = `\
<message "${uid}">
<sender>${chatLogEntry.name}</sender>
<content>
${chatLogEntry.content}
</content>
</message "${uid}">
`
						return {
							role,
							message: content
						}
					})
					request.message = messages.pop().message
					request.chatHistory = messages

					if (config.convert_config?.roleReminding ?? true) {
						const isMutiChar = new Set(prompt_struct.chat_log.map(chatLogEntry => chatLogEntry.name).filter(Boolean)).size > 2
						if (isMutiChar)
							request.chatHistory.push({
								role: 'SYSTEM',
								message: `现在请以${prompt_struct.Charname}的身份续写对话。`
							})
					}
					let text = ''

					if (config.use_stream) {
						const stream = await cohere.chatStream(request, { signal })
						for await (const message of stream) {
							if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
							if (message.type === 'text-generation') {
								text += message.text
								replyPreviewUpdater?.({ content: text })
							}
						}
					} else {
						const result = await cohere.chat(request, { signal })
						text = result?.text
						if (!text) throw result
					}

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

					const removeduplicate = [...new Set(text.split('\n'))].join('\n')
					if (removeduplicate.length / text.length < 0.3)
						text = removeduplicate

					resolve(Object.assign(base_result, {
						content: text
					}))
				} catch (e) {
					reject(e)
				}
			})
		},
		tokenizer: {
			/**
			 * 释放分词器。
			 * @returns {number} 0
			 */
			free: () => 0,
			/**
			 * 编码提示。
			 * @param {string} prompt - 要编码的提示。
			 * @returns {Promise<number[]>} 编码后的令牌。
			 */
			encode: prompt => cohere.tokenize({
				model: config.model,
				text: prompt
			}).then(result => result.tokens),
			/**
			 * 解码令牌。
			 * @param {number[]} tokens - 要解码的令牌。
			 * @returns {Promise<string>} 解码后的文本。
			 */
			decode: tokens => cohere.detokenize({
				model: config.model,
				tokens
			}).then(result => result.text),
			/**
			 * 解码单个令牌。
			 * @param {number} token - 要解码的令牌。
			 * @returns {Promise<string>} 解码后的文本。
			 */
			decode_single: token => cohere.detokenize({
				model: config.model,
				tokens: [token]
			}).then(result => result.text),
			/**
			 * 获取令牌计数。
			 * @param {string} prompt - 要计算令牌的提示。
			 * @returns {Promise<number>} 令牌数。
			 */
			get_token_count: prompt => cohere.tokenize({
				model: config.model,
				text: prompt
			}).then(result => result.tokens.length)
		}
	}

	return result
}
