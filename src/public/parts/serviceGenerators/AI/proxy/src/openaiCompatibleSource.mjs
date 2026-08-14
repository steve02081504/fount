import { createFetchChatCompletionWithRetry } from './chatCompletion.mjs'
import { identityTokenizer } from './identityTokenizer.mjs'
import { buildContentForShowFromLogprobs } from './logprobsRenderer.mjs'
import { buildMessagesFromPromptStruct } from './messageBuilder.mjs'
import { buildReasoningDetailsMarkdown } from './reasoningRenderer.mjs'
import { clearFormat } from './responseFormat.mjs'

/**
 * 组装 OpenAI 兼容 AI 源（proxy / Copilot / Cloudflare 等）。
 * @param {object} args - 参数。
 * @param {object} args.config - 服务源 config（会被 prepare 就地改 url/headers）。
 * @param {object} args.configTemplate - 默认配置。
 * @param {object} args.product_info - 产品信息。
 * @param {() => Promise<void>} args.SaveConfig - 持久化。
 * @param {boolean} [args.is_paid=true] - 是否付费源。
 * @param {(config: object) => Promise<void> | void} [args.prepare] - 每次请求前刷新凭证 / URL。
 * @returns {Promise<import('../../../../../../decl/AIsource.ts').AIsource_t>} AI 源。
 */
export async function createOpenAICompatibleSource({
	config,
	configTemplate,
	product_info,
	SaveConfig,
	is_paid = true,
	prepare,
}) {
	config.convert_config = { ...configTemplate.convert_config, ...config.convert_config }
	config.use_stream ??= true
	const fetchChatCompletionWithRetry = createFetchChatCompletionWithRetry(config, { SaveConfig })

	/**
	 * 先 prepare 再打 completions。
	 * @param {Array<object>} messages - 消息。
	 * @param {object} [options] - 生成选项。
	 * @returns {Promise<object>} 回复。
	 */
	async function run(messages, options) {
		await prepare?.(config)
		return fetchChatCompletionWithRetry(messages, options)
	}

	return {
		type: 'text-chat',
		info: Object.fromEntries(Object.entries(structuredClone(product_info)).map(([locale, localeInfo]) => {
			localeInfo.name = config.name || config.model
			return [locale, localeInfo]
		})),
		is_paid,
		extension: {},
		/**
		 * 纯文本调用。
		 * @param {string} prompt - 提示。
		 * @returns {Promise<{content: string, files: any[]}>} 回复。
		 */
		Call: async prompt => run(config.convert_config?.forceNoSystemMessages ? [
			{ role: 'user', content: 'system: ' + prompt },
		] : [
			{ role: 'system', content: prompt },
		]),
		/**
		 * 结构化调用。
		 * @param {import('../../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct - 结构化提示。
		 * @param {import('../../../../../../decl/AIsource.ts').GenerationOptions} [options] - 生成选项。
		 * @returns {Promise<{content: string, files: any[]}>} 回复。
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
			 * 组装 content_for_show。
			 * @param {object} partialResult - 片段。
			 * @param {boolean} [streaming] - 是否流式。
			 * @returns {void}
			 */
			const buildShow = (partialResult, streaming = false) => {
				let show = enableLogprobsShow ? buildContentForShowFromLogprobs(partialResult, { useThemeStyles, ...i18nRender }) : null
				if (enableHtmlShow) {
					const reasoningHtml = buildReasoningDetailsMarkdown(partialResult, { open: streaming, ...i18nRender })
					if (reasoningHtml) show = reasoningHtml + (show ?? partialResult.content)
				}
				if (show != null) partialResult.content_for_show = show
			}
			await run(messages, {
				signal,
				result,
				/**
				 * 流式预览。
				 * @param {object} partialResult - 片段。
				 * @returns {void}
				 */
				previewUpdater: partialResult => {
					const previewReply = { ...partialResult }
					buildShow(previewReply, true)
					replyPreviewUpdater?.(clearFormat(previewReply, prompt_struct))
				},
			})
			buildShow(result)
			return Object.assign(base_result, clearFormat(result, prompt_struct))
		},
		tokenizer: identityTokenizer,
	}
}
