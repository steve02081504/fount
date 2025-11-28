import { escapeRegExp } from '../../../scripts/escape.mjs'
import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/prompt_struct.mjs'

import info_dynamic from './info.dynamic.json' with { type: 'json' }
import info from './info.json' with { type: 'json' }
import { NotDiamond } from './notdiamond.mjs'
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
	name: 'notdiamond-gpt',
	email: '',
	password: '',
	model: 'gpt-3.5-turbo',
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
	const notDiamond = new NotDiamond({
		email: config.email,
		password: config.password,
	})
	/**
	 * 调用基础模型。
	 * @param {Array<object>} messages - 消息数组。
	 * @returns {Promise<string>} 模型返回的内容。
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
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @param {AIsource_StructCall_options_t} options
		 * @returns {Promise<{content: string}>} 来自 AI 的结果。
		 */
		StructCall: async (prompt_struct, { base_result, replyPreviewUpdater, signal }) => {
			return new Promise(async (resolve, reject) => {
				try {
					signal?.addEventListener('abort', () => {
						notDiamond.abort()
						reject(new DOMException('Aborted', 'AbortError'))
					})

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

					let text = ''
					if (config.use_stream) {
						const stream = await notDiamond.createStream({
							messages,
							model: config.model
						})
						for await (const chunk of stream) {
							if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
							text += chunk
							replyPreviewUpdater?.({ content: text })
						}
					} else {
						text = await callBase(messages)
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

					resolve(Object.assign(base_result, {
						content: text,
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
			 * @returns {string} 编码后的提示。
			 */
			encode: prompt => prompt,
			/**
			 * 解码令牌。
			 * @param {string} tokens - 要解码的令牌。
			 * @returns {string} 解码后的令牌。
			 */
			decode: tokens => tokens,
			/**
			 * 解码单个令牌。
			 * @param {string} token - 要解码的令牌。
			 * @returns {string} 解码后的令牌。
			 */
			decode_single: token => token,
			/**
			 * 获取令牌计数。
			 * @param {string} prompt - 要计算令牌的提示。
			 * @returns {Promise<number>} 令牌数。
			 */
			get_token_count: prompt => notDiamond.countTokens(prompt)
		}
	}

	return result
}
