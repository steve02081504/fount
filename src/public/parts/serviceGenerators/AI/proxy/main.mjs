import fs from 'node:fs'
import path from 'node:path'

import { createFetchChatCompletionWithRetry } from './src/chatCompletion.mjs'
import { buildContentForShowFromLogprobs } from './src/logprobsRenderer.mjs'
import { buildReasoningDetailsHtml } from './src/reasoningRenderer.mjs'
import { buildMessagesFromPromptStruct } from './src/messageBuilder.mjs'
import { clearFormat } from './src/responseFormat.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/** @typedef {import('../../../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

/**
 * Proxy AI 来源生成器模块定义。
 * @type {import('../../../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	info,
	interfaces: {
		serviceGenerator: {
			/**
			 * 获取此 AI 源的配置显示内容。
			 * @returns {Promise<object>} 配置显示内容。
			 */
			GetConfigDisplayContent: async () => ({
				js: fs.readFileSync(path.join(import.meta.dirname, 'display.mjs'), 'utf-8')
			}),
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
	name: 'openai-proxy',
	url: 'https://api.openai.com/v1/chat/completions',
	model: 'gpt-3.5-turbo',
	apikey: '',
	model_arguments: {
		temperature: 1,
		n: 1,
		logprobs: false,
		top_logprobs: 5,
	},
	custom_headers: {},
	convert_config: {
		roleReminding: true,
		ignoreFiles: false,
		forceRoleAlternation: false,
		forceUserMessageEnding: false,
		forceNoSystemMessages: false,
	},
	use_stream: true,
}
/**
 * 获取 Proxy AI 源。
 * @param {object} config - 配置对象。
 * @param {object} root0 - 根对象。
 * @param {Function} root0.SaveConfig - 保存配置的函数。
 * @returns {Promise<AIsource_t>} AI 源。
 */
async function GetSource(config, { SaveConfig }) {
	config.use_stream ??= true
	const fetchChatCompletionWithRetry = createFetchChatCompletionWithRetry(config, { SaveConfig })
	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: Object.fromEntries(Object.entries(structuredClone(product_info)).map(([locale, localeInfo]) => {
			localeInfo.name = config.name || config.model
			return [locale, localeInfo]
		})),
		is_paid: false,
		extension: {},

		/**
		 * 调用 AI 源。
		 * @param {string} prompt - 要发送给 AI 的提示。
		 * @returns {Promise<{content: string, files: any[]}>} 来自 AI 的结果。
		 */
		Call: async prompt => {
			return await fetchChatCompletionWithRetry(config.convert_config?.forceNoSystemMessages ? [
				{
					role: 'user',
					content: 'system: ' + prompt
				}
			] : [
				{
					role: 'system',
					content: prompt
				}
			])
		},
		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @param {import('../../../../../decl/AIsource.ts').GenerationOptions} [options] - 生成选项。
		 * @returns {Promise<{content: string, files: any[]}>} 来自 AI 的结果。
		 */
		StructCall: async (prompt_struct, options = {}) => {
			const { base_result = {}, replyPreviewUpdater, signal, supported_functions } = options
			const enableLogprobsShow = config.model_arguments?.logprobs && supported_functions?.html
			const enableHtmlShow = supported_functions?.html ?? false
			const useThemeStyles = supported_functions?.fount_themes ?? false
			const messages = buildMessagesFromPromptStruct(prompt_struct, config, configTemplate)

			const result = {
				content: '',
				files: [...base_result?.files || []],
				extension: { ...base_result?.extension },
			}

			/**
			 * 构建 content_for_show：先 logprobs，再在开头插入 reasoning details 块。
			 * @param {{content: string, extension?: any}} partialResult - 结果对象
			 * @param {boolean} [streaming] - 流式预览时为 true，details 默认展开；结束后为 false，默认折叠。
			 * @returns {void}
			 */
			const buildShow = (partialResult, streaming = false) => {
				let show = enableLogprobsShow ? buildContentForShowFromLogprobs(partialResult, { useThemeStyles }) : null
				if (enableHtmlShow) {
					const reasoningHtml = buildReasoningDetailsHtml(partialResult, { open: streaming })
					if (reasoningHtml) show = reasoningHtml + (show ?? partialResult.content)
				}
				if (show != null) partialResult.content_for_show = show
			}

			/**
			 * 预览更新器：将当前累积结果的快照（含 reasoning HTML）发送给上游。
			 * @param {{content: string, files: any[]}} partialResult - 当前累积结果对象
			 * @returns {void}
			 */
			const previewUpdater = partialResult => {
				const previewReply = { ...partialResult }
				buildShow(previewReply, true)
				replyPreviewUpdater?.(clearFormat(previewReply, prompt_struct))
			}

			await fetchChatCompletionWithRetry(messages, {
				signal, previewUpdater, result
			})

			buildShow(result)

			return Object.assign(base_result, clearFormat(result, prompt_struct))
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
			 * @returns {number} 令牌数。
			 */
			get_token_count: prompt => prompt.length
		}
	}
	return result
}
