import { buildEnvelopeChatMessages } from '../proxy/src/envelopeMessages.mjs'
import { identityTokenizer } from '../proxy/src/identityTokenizer.mjs'
import { cleanupResponseText } from '../proxy/src/responseFormat.mjs'
import { buildSourceInfo } from '../proxy/src/sourceInfo.mjs'

import { DuckDuckGoAPI } from './duckduckgo.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * DuckDuckGo AI 来源生成器模块定义。
 * @typedef {import('../../../../../decl/AIsource.ts').AIsource_t} AIsource_t
 * @typedef {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t
 */

/**
 * DuckDuckGo AI 来源生成器部件。
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
	context_size: 128000,
	use_stream: true,
	system_prompt_at_depth: 10,
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

	/**
	 * AI 源实例。
	 * @type {AIsource_t}
	 */
	const result = {
		type: 'text-chat',
		info: buildSourceInfo(product_info, config),
		is_paid: false,
		extension: {},
		context_size: config.context_size ?? configTemplate.context_size,

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
		StructCall: async (prompt_struct, options = {}) => {
			const { base_result = {}, replyPreviewUpdater, signal } = options

			const messages = buildEnvelopeChatMessages(prompt_struct, {
				systemPromptAtDepth: config.system_prompt_at_depth ?? configTemplate.system_prompt_at_depth,
				roleReminding: config.convert_config?.roleReminding ?? true,
			})

			/**
			 * 清理 AI 响应的格式，移除 XML 标签和不完整的标记。
			 * @param {object} res - 原始响应对象。
			 * @param {string} res.content - 响应内容。
			 * @returns {object} - 清理后的响应对象。
			 */
			function clearFormat(res) {
				res.content = cleanupResponseText(res.content, prompt_struct)
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

		/**
		 * 按本源配置把 prompt_struct 构建成信封消息结构，供快照与缓存对比。
		 * @param {prompt_struct_t} prompt_struct - 结构化提示。
		 * @returns {Promise<Array<{role: string, content: string}>>} 消息数组。
		 */
		BuildPrompt: async prompt_struct => buildEnvelopeChatMessages(prompt_struct, {
			systemPromptAtDepth: config.system_prompt_at_depth ?? configTemplate.system_prompt_at_depth,
			roleReminding: config.convert_config?.roleReminding ?? true,
		}),

		tokenizer: identityTokenizer,
	}

	return result
}
