import { escapeRegExp } from '../../../scripts/escape.mjs'
import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/prompt_struct.mjs'

import { GrokAPI } from './grokAPI.mjs'

/**
 * @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t
 * @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t
 */

import info from './info.json' with { type: 'json' }
import info_dynamic from './info.dynamic.json' with { type: 'json' }

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
	name: 'Grok',
	model: 'grok-3',
	cookies: [],
	convert_config: {
		roleReminding: true
	}
}

/**
 * 创建一个 Grok AI 来源生成器
 * @param {object} config - 配置对象
 * @param {string} [config.name] - AI 来源的名称，默认为模型名称
 * @param {string} [config.model] - 使用的模型，默认为 'grok-3'
 * @param {string[]} [config.cookies] - Grok Cookies 数组
 * @returns {Promise<AIsource_t>} AI 来源对象
 */
async function GetSource(config) {
	const grok = new GrokAPI(config)

	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: Object.fromEntries(Object.entries(structuredClone(info_dynamic)).map(([k, v]) => {
			v.name = config.name || config.model
			return [k, v]
		})),
		is_paid: false, // 根据实际情况设置
		extension: {},

		/**
		 * 卸载 AI 源。
		 */
		Unload: () => {
			// 清理操作（如果有的话）
		},

		/**
		 * 调用 AI 源。
		 * @param {string} prompt - 要发送给 AI 的提示。
		 * @returns {Promise<{content: string}>} 来自 AI 的结果。
		 */
		Call: async prompt => {
			const messages = [{ role: 'user', content: prompt }]
			const model = config.model || 'grok-3'
			const returnStream = config?.stream || false
			const result = await grok.call(messages, model, returnStream)
			return {
				content: result,
			}
		},

		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @returns {Promise<{content: string}>} 来自 AI 的结果。
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
				const isMutiChar = new Set(prompt_struct.chat_log.map(chatLogEntry => chatLogEntry.name).filter(Boolean)).size > 2
				if (isMutiChar)
					messages.push({
						role: 'system',
						content: `现在请以${prompt_struct.Charname}的身份续写对话。`
					})
			}

			const model = config.model || 'grok-3'
			let text = await grok.call(messages, model)

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
			 * 释放分词器。
			 * @returns {number} 0
			 */
			free: () => 0, // 或者根据实际情况计算
			/**
			 * 编码提示。
			 * @param {string} prompt - 要编码的提示。
			 * @returns {string} 编码后的提示。
			 */
			encode: prompt => prompt, // Grok 不需要特殊的编码
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
			get_token_count: prompt => grok.countTokens(prompt),
		},
		/**
		 * 生成图像。
		 * @param {string} prompt - 提示。
		 * @param {number} n - 生成图像的数量。
		 * @returns {Promise<{data: any}>} 图像数据。
		 */
		generateImage: async (prompt, n) => {
			const images = await grok.generateImage(prompt, n)
			return {
				data: images
			}
		}
	}

	return result
}
