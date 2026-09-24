import { with_timeout } from '../../../../../scripts/await_timeout.mjs'
import { buildEnvelopeChatMessages } from '../proxy/src/envelopeMessages.mjs'
import { estimateTokenCount } from '../proxy/src/identityTokenizer.mjs'
import { cleanupResponseText } from '../proxy/src/responseFormat.mjs'
import { buildSourceInfo } from '../proxy/src/sourceInfo.mjs'

import { BlackboxAI } from './blackbox.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * AI 源类型别名。
 * @typedef {import('../../../../../decl/AIsource.ts').AIsource_t} AIsource_t
 */
/**
 * 提示词结构类型别名。
 * @typedef {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t
 */

/**
 * Blackbox AI 来源生成器模块定义。
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
	name: 'Blackbox',
	model: 'claude-3-5-sonnet',
	context_size: 128000,
	timeout: 10000,
	system_prompt_at_depth: 10,
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
	const blackbox = new BlackboxAI(config)
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
		 * 调用 AI 源。
		 * @param {string} prompt - 要发送给 AI 的提示。
		 * @returns {Promise<{content: string}>} AI 的返回结果。
		 */
		Call: async prompt => {
			const result = await with_timeout(config.timeout || 10000, blackbox.call(prompt, config.model))
			return {
				content: result,
			}
		},
		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @param {import('../../../../../decl/AIsource.ts').GenerationOptions} [options] - 生成选项。
		 * @returns {Promise<{content: string}>} AI 的返回结果。
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

			const callPromise = blackbox.call(messages, config.model)
			const timeoutPromise = with_timeout(config.timeout || 10000, callPromise)

			// Handle abort during call
			if (signal)
				signal.addEventListener('abort', () => {
					// The blackbox call doesn't support abort, but we can at least stop waiting
				})


			result.content = await timeoutPromise
			previewUpdater(result)

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
			 * @param {string} prompt - 要计算令牌数的提示。
			 * @returns {Promise<number>} 令牌数。
			 */
			get_token_count: prompt => blackbox.countTokens(prompt)
				.catch(error => {
					console.warn('Failed to get token count from Blackbox API, falling back to estimate.', error)
					return estimateTokenCount(prompt)
				})
		}
	}

	return result
}
