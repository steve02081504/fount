import { identityTokenizer } from '../../proxy/src/identityTokenizer.mjs'
import { buildMessagesFromPromptStruct } from '../../proxy/src/messageBuilder.mjs'
import { clearFormat } from '../../proxy/src/responseFormat.mjs'

import { fetchResponses, messagesToResponsesBody } from './responsesClient.mjs'

/**
 * 组装 Responses API AI 源（Codex / Azure Responses）。
 * @param {object} args - 参数。
 * @param {object} args.config - 服务源 config。
 * @param {object} args.configTemplate - 默认配置。
 * @param {object} args.product_info - 产品信息。
 * @param {boolean} [args.is_paid=true] - 是否付费源。
 * @param {() => Promise<{url: string, headers: Record<string, string>}>} args.resolveRequest - 每次请求解析 URL/头。
 * @returns {Promise<import('../../../../../../decl/AIsource.ts').AIsource_t>} AI 源。
 */
export async function createResponsesSource({
	config,
	configTemplate,
	product_info,
	is_paid = true,
	resolveRequest,
}) {
	config.convert_config = { ...configTemplate.convert_config, ...config.convert_config }
	config.use_stream ??= true

	/**
	 * 打 Responses。
	 * @param {Array<object>} messages - 消息。
	 * @param {object} [options] - 选项。
	 * @returns {Promise<object>} 回复。
	 */
	async function run(messages, options = {}) {
		const { url, headers } = await resolveRequest()
		return fetchResponses({
			url,
			headers,
			body: messagesToResponsesBody(messages, {
				model: config.model,
				stream: config.use_stream,
				model_arguments: config.model_arguments,
			}),
			signal: options.signal,
			previewUpdater: options.previewUpdater,
			result: options.result,
		})
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
		Call: async prompt => run([{ role: 'user', content: prompt }]),
		/**
		 * 结构化调用。
		 * @param {import('../../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct - 结构化提示。
		 * @param {import('../../../../../../decl/AIsource.ts').GenerationOptions} [options] - 生成选项。
		 * @returns {Promise<{content: string, files: any[]}>} 回复。
		 */
		StructCall: async (prompt_struct, options = {}) => {
			const { base_result = {}, replyPreviewUpdater, signal } = options
			const messages = await buildMessagesFromPromptStruct(prompt_struct, config, configTemplate)
			const result = {
				content: '',
				files: [...base_result?.files || []],
				extension: { ...base_result?.extension },
			}
			await run(messages, {
				signal,
				result,
				/**
				 * 流式预览。
				 * @param {object} partialResult - 片段。
				 * @returns {void}
				 */
				previewUpdater: partialResult => replyPreviewUpdater?.(clearFormat({ ...partialResult }, prompt_struct)),
			})
			return Object.assign(base_result, clearFormat(result, prompt_struct))
		},
		tokenizer: identityTokenizer,
	}
}
