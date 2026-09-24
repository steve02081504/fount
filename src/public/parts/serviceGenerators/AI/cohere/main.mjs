import { mergeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../../shells/chat/src/prompt_struct/index.mjs'
import { estimateTokenCount } from '../proxy/src/identityTokenizer.mjs'
import { cleanupResponseText } from '../proxy/src/responseFormat.mjs'
import { buildSourceInfo } from '../proxy/src/sourceInfo.mjs'

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
 * Cohere AI 来源生成器模块定义。
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
	context_size: 128000,
	use_stream: true,
	convert_config: {
		roleReminding: true
	}
}
/**
 * 把 prompt_struct 构建成 Cohere 出站 `messages`（system 置顶 + 聊天记录 + 多角色提醒）。
 * @param {prompt_struct_t} prompt_struct - 结构化提示。
 * @param {object} config - 当前服务配置。
 * @returns {Array<{role: 'user'|'assistant'|'system', content: string}>} 消息数组。
 */
function buildCohereMessages(prompt_struct, config) {
	const messages = [{
		role: 'system',
		content: structPromptToSingleNoChatLog(prompt_struct)
	}]
	mergeStructPromptChatLog(prompt_struct).forEach(chatLogEntry => {
		const uid = chatLogEntry.id ||= crypto.randomUUID().slice(0, 8)
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

	if (config.convert_config?.roleReminding ?? true) {
		const isMultiChar = new Set(prompt_struct.chat_log.map(chatLogEntry => chatLogEntry.name).filter(Boolean)).size > 2
		if (isMultiChar)
			messages.push({
				role: 'system',
				content: `现在请以${prompt_struct.Charname}的身份续写对话。`
			})
	}

	return messages
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
		StructCall: async (prompt_struct, options = {}) => {
			const { base_result = {}, replyPreviewUpdater, signal } = options

			const request = {
				model: config.model,
				messages: buildCohereMessages(prompt_struct, config)
			}

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
		/**
		 * 按本源配置把 prompt_struct 构建成 Cohere 出站 `{ model, messages }`，供快照与缓存对比。
		 * @param {prompt_struct_t} prompt_struct - 结构化提示。
		 * @returns {Promise<{model: string, messages: Array<{role: 'user'|'assistant'|'system', content: string}>}>} 出站结构。
		 */
		BuildPrompt: async prompt_struct => ({
			model: config.model,
			messages: buildCohereMessages(prompt_struct, config),
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
			}).then(result => result.tokens.length).catch(error => {
				console.warn('Failed to get token count from Cohere API, falling back to estimate.', error)
				return estimateTokenCount(prompt)
			})
		}
	}

	return result
}
