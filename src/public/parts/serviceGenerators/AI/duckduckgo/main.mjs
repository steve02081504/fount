import { escapeRegExp } from '../../../../../scripts/regex.mjs'
import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../../shells/chat/src/prompt_struct.mjs'

import { DuckDuckGoAPI } from './duckduckgo.mjs'
import info_dynamic from './info.dynamic.json' with { type: 'json' }
import info from './info.json' with { type: 'json' }

/**
 * @typedef {import('../../../../../decl/AIsource.ts').AIsource_t} AIsource_t
 * @typedef {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t
 */

/**
 *
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
	name: 'DuckDuckGo',
	model: 'gpt-4o-mini',
	use_stream: true,
	convert_config: {
		roleReminding: true
	}
}
/**
 * 创建一个 DuckDuckGo AI 来源生成器
 * @param {object} config - 配置对象
 * @param {string} [config.name] - AI 来源的名称，默认为模型名称
 * @param {string} [config.model] - 使用的模型，默认为 'gpt-4o-mini'
 * @param {object} [config.fake_headers] - 自定义的请求头
 * @returns {Promise<AIsource_t>} AI 来源对象
 */
async function GetSource(config) {
	const duckduckgo = new DuckDuckGoAPI(config)

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
		 * 卸载 AI 源。
		 */
		Unload: () => {
			// 在这里执行清理操作，如果有必要的话
		},

		/**
		 * 调用 AI 源。
		 * @param {string} prompt - 要发送给 AI 的提示。
		 * @returns {Promise<{content: string}>} 来自 AI 的结果。
		 */
		Call: async prompt => {
			const messages = [{ role: 'user', content: prompt }] // 将字符串 prompt 包装成一个消息对象
			const model = config.model || 'gpt-4o-mini'
			const returnStream = config?.stream || false
			const result = await duckduckgo.call(messages, model, returnStream)
			return {
				content: result,
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
				const isMultiChar = new Set(prompt_struct.chat_log.map(chatLogEntry => chatLogEntry.name).filter(Boolean)).size > 2
				if (isMultiChar)
					messages.push({
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

			// Check for abort before starting
			if (signal?.aborted) {
				const err = new Error('Aborted by user')
				err.name = 'AbortError'
				throw err
			}

			const model = config.model || 'gpt-4o-mini'

			// Use streaming based on config
			const useStream = (config.use_stream ?? true) && !!replyPreviewUpdater
			const response = await duckduckgo.call(messages, model, useStream, signal)

			if (useStream) {
				// Handle streaming response
				const reader = response.body.getReader()
				const decoder = new TextDecoder()

				try {
					while (true) {
						if (signal?.aborted) {
							const err = new Error('Aborted by user')
							err.name = 'AbortError'
							reader.cancel(err).catch(() => { })
							throw err
						}

						const { done, value } = await reader.read()
						if (done) break

						const chunk = decoder.decode(value, { stream: true })
						const lines = chunk.split('\n')

						for (const line of lines)
							if (line.startsWith('data: ')) {
								const data = line.slice(6)
								if (data === '[DONE]') continue

								try {
									const json = JSON.parse(data)
									const content = json.choices?.[0]?.delta?.content
									if (content) {
										result.content += content
										previewUpdater(result)
									}
								} catch (e) {
									// Skip invalid JSON
								}
							}
					}
				} finally {
					reader.releaseLock()
				}
			} else {
				// Handle non-streaming response
				const text = await response.text()
				try {
					const json = JSON.parse(text)
					result.content = json.choices?.[0]?.message?.content || text
				} catch {
					result.content = text
				}
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
			get_token_count: prompt => duckduckgo.countTokens(prompt)
		}
	}

	return result
}
