import { buildEnvelopeChatMessages } from '../proxy/src/envelopeMessages.mjs'
import { cleanupResponseText } from '../proxy/src/responseFormat.mjs'
import { buildSourceInfo } from '../proxy/src/sourceInfo.mjs'

import { GrokAPI } from './grokAPI.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * Grok AI 来源生成器模块定义。
 * @typedef {import('../../../../../decl/AIsource.ts').AIsource_t} AIsource_t
 * Grok AI 来源生成器结构化提示类型
 * @typedef {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t
 */

/**
 * Grok AI 来源生成器部件。
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
	name: 'Grok',
	model: 'grok-3',
	context_size: 131072,
	cookies: [],
	use_stream: true,
	system_prompt_at_depth: 10,
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

	/**
	 * AI 源实例。
	 * @type {AIsource_t}
	 */
	const result = {
		type: 'text-chat',
		info: buildSourceInfo(product_info, config),
		is_paid: false, // 根据实际情况设置
		extension: {},
		context_size: config.context_size ?? configTemplate.context_size,

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
		 * @param {import('../../../../../decl/AIsource.ts').GenerationOptions} [options] - 生成选项。
		 * @returns {Promise<{content: string, files: any[]}>} 来自 AI 的结果。
		 */
		StructCall: async (prompt_struct, options = {}) => {
			const { base_result = {}, replyPreviewUpdater, signal } = options

			const messages = buildEnvelopeChatMessages(prompt_struct, {
				systemPromptAtDepth: config.system_prompt_at_depth ?? configTemplate.system_prompt_at_depth,
				roleReminding: config.convert_config?.roleReminding ?? true,
				indent: '\t\t ',
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

			const model = config.model || 'grok-3'

			// Use streaming based on config
			const useStream = (config.use_stream ?? true) && !!replyPreviewUpdater

			if (useStream) {
				/**
				 * 处理流式增量
				 * @param {string} delta - 增量内容
				 */
				const onDelta = (delta) => {
					result.content += delta
					previewUpdater(result)
				}
				// Use grok's streaming support via the call method
				await grok.call(messages, model, true, onDelta, signal)
			} else {
				// Use non-streaming mode
				result.content = await grok.call(messages, model, false)
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
			indent: '\t\t ',
		}),

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
