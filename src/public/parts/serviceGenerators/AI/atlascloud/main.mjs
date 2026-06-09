import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { createFetchChatCompletionWithRetry } from '../proxy/src/chatCompletion.mjs'
import { buildContentForShowFromLogprobs } from '../proxy/src/logprobsRenderer.mjs'
import { buildMessagesFromPromptStruct } from '../proxy/src/messageBuilder.mjs'
import { buildReasoningDetailsHtml } from '../proxy/src/reasoningRenderer.mjs'
import { clearFormat } from '../proxy/src/responseFormat.mjs'

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
 * Atlas Cloud AI 来源生成器模块定义。
 * @type {import('../../../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	info,
	interfaces: {
		serviceGenerator: {
			/**
			 * 获取配置页显示脚本。
			 * @returns {Promise<{ js: string }>} 配置页脚本
			 */
			GetConfigDisplayContent: async () => ({
				js: fs.readFileSync(path.join(import.meta.dirname, 'display.mjs'), 'utf-8')
			}),
			/**
			 * 获取默认配置模板。
			 * @returns {Promise<object>} 默认配置模板
			 */
			GetConfigTemplate: async () => structuredClone(configTemplate),
			GetSource,
		}
	}
}

const atlasCloudHomepage = 'https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=fount'
const configTemplate = {
	name: 'Atlas Cloud',
	url: 'https://api.atlascloud.ai/v1/chat/completions',
	model: 'deepseek-ai/DeepSeek-V3-0324',
	apikey: process.env.ATLASCLOUD_API_KEY || '',
	model_arguments: {
		temperature: 1,
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
 * 将持久化配置与 Atlas Cloud 默认配置合并。
 * @param {object} [config] 已存储的配置。
 * @returns {object} 合并后的配置。
 */
function normalizeConfig(config = {}) {
	return {
		...structuredClone(configTemplate),
		...config,
		model_arguments: {
			...configTemplate.model_arguments,
			...config?.model_arguments,
		},
		custom_headers: {
			...configTemplate.custom_headers,
			...config?.custom_headers,
		},
		convert_config: {
			...configTemplate.convert_config,
			...config?.convert_config,
		},
	}
}

/**
 * 根据 Atlas Cloud 定义构建本地化元数据。
 * @param {object} config 提供方配置。
 * @returns {Record<string, any>} 本地化元数据。
 */
function buildProductInfo(config) {
	return Object.fromEntries(Object.entries(structuredClone(product_info)).map(([locale, localeInfo]) => {
		localeInfo.name = config.name || config.model
		localeInfo.provider = 'Atlas Cloud'
		localeInfo.home_page = atlasCloudHomepage
		return [locale, localeInfo]
	}))
}

/**
 * 创建 Atlas Cloud AI 来源实例。
 * @param {object} config 已存储的配置对象。
 * @param {{ SaveConfig: Function }} root0 生成器依赖。
 * @returns {Promise<AIsource_t>} AI 来源实例。
 */
async function GetSource(config, { SaveConfig }) {
	config = normalizeConfig(config)
	config.use_stream ??= true
	const fetchChatCompletionWithRetry = createFetchChatCompletionWithRetry(config, { SaveConfig })
	/**
	 * AI 源实例。
	 * @type {AIsource_t}
	 */
	const result = {
		type: 'text-chat',
		info: buildProductInfo(config),
		is_paid: true,
		extension: {},

		/**
		 * 使用纯文本提示调用提供方。
		 * @param {string} prompt 提示词内容。
		 * @returns {Promise<{content: string, files: any[]}>} 提供方返回结果。
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
		 * 使用 fount 结构化提示词调用提供方。
		 * @param {prompt_struct_t} prompt_struct 结构化提示词输入。
		 * @param {import('../../../../../decl/AIsource.ts').GenerationOptions} [options] 生成选项。
		 * @returns {Promise<{content: string, files: any[]}>} 提供方返回结果。
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

			const i18nRender = { locales: prompt_struct.locales, supported_functions }
			/**
			 * 构建 content_for_show 展示内容。
			 * @param {object} partialResult 流式/最终回复对象
			 * @param {boolean} [streaming] 是否流式预览
			 * @returns {void}
			 */
			const buildShow = (partialResult, streaming = false) => {
				let show = enableLogprobsShow ? buildContentForShowFromLogprobs(partialResult, { useThemeStyles, ...i18nRender }) : null
				if (enableHtmlShow) {
					const reasoningHtml = buildReasoningDetailsHtml(partialResult, { open: streaming, ...i18nRender })
					if (reasoningHtml) show = reasoningHtml + (show ?? partialResult.content)
				}
				if (show != null) partialResult.content_for_show = show
			}

			/**
			 * 预览更新器，将流式片段推送给上游。
			 * @param {object} partialResult 流式片段
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
			 * 释放分词器占用（本地无 tokenizer，恒为 0）。
			 * @returns {number} 恒为 0
			 */
			free: () => 0,
			/**
			 * 编码文本（无本地 tokenizer，原样返回）。
			 * @param {string} prompt 文本
			 * @returns {string} 原样返回
			 */
			encode: prompt => prompt,
			/**
			 * 解码令牌串（无本地 tokenizer，原样返回）。
			 * @param {string} tokens 令牌串
			 * @returns {string} 原样返回
			 */
			decode: tokens => tokens,
			/**
			 * 解码单个令牌（无本地 tokenizer，原样返回）。
			 * @param {string} token 单令牌
			 * @returns {string} 原样返回
			 */
			decode_single: token => token,
			/**
			 * 统计文本长度作为令牌数近似值。
			 * @param {string} prompt 文本
			 * @returns {number} 字符长度
			 */
			get_token_count: prompt => prompt.length
		}
	}
	return result
}
