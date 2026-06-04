import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { createFetchChatCompletionWithRetry } from '../proxy/src/chatCompletion.mjs'
import { buildContentForShowFromLogprobs } from '../proxy/src/logprobsRenderer.mjs'
import { buildMessagesFromPromptStruct } from '../proxy/src/messageBuilder.mjs'
import { buildReasoningDetailsHtml } from '../proxy/src/reasoningRenderer.mjs'
import { clearFormat } from '../proxy/src/responseFormat.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/** @typedef {import('../../../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

/**
 * Evolink AI source generator.
 * @type {import('../../../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	info,
	interfaces: {
		serviceGenerator: {
			/**
			 * @returns {Promise<{ js: string }>} 配置页脚本
			 */
			GetConfigDisplayContent: async () => ({
				js: fs.readFileSync(path.join(import.meta.dirname, 'display.mjs'), 'utf-8')
			}),
			/**
			 * @returns {Promise<object>} 默认配置模板
			 */
			GetConfigTemplate: async () => structuredClone(configTemplate),
			GetSource,
		}
	}
}

const evolinkHomepage = 'https://evolink.ai/?utm_source=github&utm_medium=link&utm_campaign=fount'
const configTemplate = {
	name: 'Evolink',
	url: 'https://direct.evolink.ai/v1/chat/completions',
	model: 'gpt-5.5',
	apikey: process.env.EVOLINK_API_KEY || '',
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
 * Merge persisted config with the Evolink defaults.
 * @param {object} [config] - Stored config.
 * @returns {object} Merged config.
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
 * Build localized metadata from the Evolink definitions.
 * @param {object} config - Provider config.
 * @returns {Record<string, any>} Localized metadata.
 */
function buildProductInfo(config) {
	return Object.fromEntries(Object.entries(structuredClone(product_info)).map(([locale, localeInfo]) => {
		localeInfo.name = config.name || config.model
		localeInfo.provider = 'Evolink'
		localeInfo.home_page = evolinkHomepage
		return [locale, localeInfo]
	}))
}

/**
 * Create the Evolink AI source.
 * @param {object} config - Stored config object.
 * @param {{ SaveConfig: Function }} root0 - Generator dependencies.
 * @returns {Promise<AIsource_t>} AI source.
 */
async function GetSource(config, { SaveConfig }) {
	config = normalizeConfig(config)
	config.use_stream ??= true
	const fetchChatCompletionWithRetry = createFetchChatCompletionWithRetry(config, { SaveConfig })
	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: buildProductInfo(config),
		is_paid: true,
		extension: {},

		/**
		 * Call the provider with a plain prompt.
		 * @param {string} prompt - Prompt content.
		 * @returns {Promise<{content: string, files: any[]}>} Provider result.
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
		 * Call the provider with fount's structured prompt.
		 * @param {prompt_struct_t} prompt_struct - Structured prompt input.
		 * @param {import('../../../../../decl/AIsource.ts').GenerationOptions} [options] - Generation options.
		 * @returns {Promise<{content: string, files: any[]}>} Provider result.
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
			 * @returns {number} 恒为 0（无本地 tokenizer 占用）
			 */
			free: () => 0,
			/**
			 * @param {string} prompt 文本
			 * @returns {string} 原样返回
			 */
			encode: prompt => prompt,
			/**
			 * @param {string} tokens 令牌串
			 * @returns {string} 原样返回
			 */
			decode: tokens => tokens,
			/**
			 * @param {string} token 单令牌
			 * @returns {string} 原样返回
			 */
			decode_single: token => token,
			/**
			 * @param {string} prompt 文本
			 * @returns {number} 字符长度
			 */
			get_token_count: prompt => prompt.length
		}
	}
	return result
}
