import { escapeRegExp } from '../../../../../scripts/escape.mjs'
import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../../shells/chat/src/prompt_struct.mjs'

import info_dynamic from './info.dynamic.json' with { type: 'json' }
import info from './info.json' with { type: 'json' }
/** @typedef {import('../../../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

/**
 * @type {import('../../../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	info,
	interfaces: {
		serviceGenerator: {
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
	use_stream: true,
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
	const { CohereClientV2 } = await import('npm:cohere-ai')
	const cohere = new CohereClientV2({
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
		 * @param {import('../../../../../decl/AIsource.ts').GenerationOptions} [options] - 生成选项。
		 * @returns {Promise<{content: string}>} 来自 AI 的结果。
		 */
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct, options = {}) => {
			const { base_result = {}, replyPreviewUpdater, signal } = options

			const system_prompt = structPromptToSingleNoChatLog(prompt_struct)
			const request = {
				model: config.model,
				messages: [{
					role: 'system',
					content: system_prompt
				}]
			}
			margeStructPromptChatLog(prompt_struct).forEach(chatLogEntry => {
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
				const isMultiChar = new Set(prompt_struct.chat_log.map(chatLogEntry => chatLogEntry.name).filter(Boolean)).size > 2
				if (isMultiChar)
					request.messages.push({
						role: 'system',
						content: `现在请以${prompt_struct.Charname}的身份续写对话。`
					})
			}

			/**
			 * 清理 AI 响应的格式，移除 XML 标签和不完整的标记。
			 * @param {object} res - 原始响应对象。
			 * @param {string} res.content - 响应内容。
			 * @returns {object} - 清理后的响应对象。
			 */
			function clearFormat(res) {
				let text = res.content
				if (text.match(/<\/sender>\s*<content>/))
					text = (text.match(/<\/sender>\s*<content>([\S\s]*)/)?.[1] ?? text).split(new RegExp(
						`(${(prompt_struct.alternative_charnames || []).map(Object).map(
							s => s instanceof String ? escapeRegExp(s) : s.source
						).join('|')})\\s*<\\/sender>\\s*<content>`
					)).pop().split(/<\/content>\s*<\/message/).shift()
				if (text.match(/<\/content>\s*<\/message[^>]*>\s*$/))
					text = text.split(/<\/content>\s*<\/message[^>]*>\s*$/).shift()
				// 清理可能出现的不完整的结束标签
				text = text.replace(/<\/content\s*$/, '').replace(/<\/message\s*$/, '').replace(/<\/\s*$/, '')
				res.content = text
				return res
			}

			// Check for abort before starting
			if (signal?.aborted) {
				const err = new Error('Aborted by user')
				err.name = 'AbortError'
				throw err
			}

			const result = {
				content: '',
				files: [...base_result?.files || []],
			}

			/**
			 * 预览更新器
			 * @param {{content: string, files: any[]}} r - 结果对象
			 * @returns {void}
			 */
			const previewUpdater = r => replyPreviewUpdater?.(clearFormat({ ...r }))

			// Use streaming based on config
			const useStream = (config.use_stream ?? true) && !!replyPreviewUpdater
			if (useStream) {
				// Use cohere's streaming support
				const stream = await cohere.chatStream(request)

				for await (const chunk of stream) {
					if (signal?.aborted) {
						const err = new Error('Aborted by user')
						err.name = 'AbortError'
						throw err
					}

					if (chunk.eventType === 'text-generation') {
						result.content += chunk.text || ''
						previewUpdater(result)
					}
				}
			} else {
				// Use non-streaming mode
				const apiResult = await cohere.chat(request)
				let text = apiResult?.message?.content?.map(message => message?.text)?.filter(text => text)?.join('\n')
				if (!text) throw apiResult

				const removeduplicate = [...new Set(text.split('\n'))].join('\n')
				if (removeduplicate.length / text.length < 0.3)
					text = removeduplicate

				result.content = text
				previewUpdater(result)
			}

			return Object.assign(base_result, clearFormat(result))
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
