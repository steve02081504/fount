// 导入 Anthropic SDK（用于 DeepSeek 的 Anthropic 兼容 API）和 fount 需要的工具函数
import { escapeRegExp } from '../../../scripts/escape.mjs'
import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/prompt_struct.mjs'

import info_dynamic from './info.dynamic.json' with { type: 'json' }
import info from './info.json' with { type: 'json' }
/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

/**
 * @type {import('../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	info,
	interfaces: {
		AIsource: {
			/**
			 * 获取此 AI 源的配置模板。
			 * @returns {Promise<object>} 配置模板。
			 */
			GetConfigTemplate: async () => configTemplate,
			GetSource,
		}
	}
}

// DeepSeek 模块的默认配置模板（通过 Anthropic 兼容 API 访问）
const configTemplate = {
	name: 'deepseek-chat',
	apikey: '',
	model: 'deepseek-chat',
	model_arguments: {
	},
	proxy_url: '', // 例如 'http://127.0.0.1:7890'
	base_url: 'https://api.deepseek.com/anthropic', // DeepSeek 的 Anthropic 兼容 API 地址
	use_stream: true,
}

/**
 * 获取 AI 源。
 * @param {object} config - 配置对象。
 * @returns {Promise<AIsource_t>} AI 源。
 */
async function GetSource(config) {
	const { default: Anthropic } = await import('npm:@anthropic-ai/sdk')
	// 初始化 Anthropic 客户端
	const clientOptions = {
		apiKey: config.apikey,
	}

	// 如果配置了 base_url，则设置自定义API地址
	if (config.base_url) {
		clientOptions.baseURL = config.base_url
	}

	// 如果配置了代理 URL，则设置HTTP代理
	if (config.proxy_url) {
		const undici = await import('npm:undici')
		clientOptions.fetchOptions = {
			dispatcher: new undici.ProxyAgent(config.proxy_url),
		}
	}

	const client = new Anthropic(clientOptions)

	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: Object.fromEntries(Object.entries(structuredClone(info_dynamic)).map(([k, v]) => {
			v.name = config.name || config.model
			return [k, v]
		})),
		is_paid: true,
		extension: {},

		// 简单的文本调用
		/**
		 * 调用 AI 源。
		 * @param {string} prompt - 要发送给 AI 的提示。
		 * @returns {Promise<{content: string}>} 来自 AI 的结果。
		 */
		Call: async prompt => {
			const params = {
				model: config.model,
				messages: [{ role: 'user', content: prompt }],
				...config.model_arguments,
			}

			let text = ''

			if (config.use_stream) {
				const stream = await client.messages.create({ ...params, stream: true })
				for await (const event of stream)
					if (event.type === 'content_block_delta' && event.delta.type === 'text_delta')
						text += event.delta.text
			}
			else {
				const message = await client.messages.create(params)
				// 响应 content 是一个数组，我们只取文本部分
				text = message.content.filter(block => block.type === 'text').map(block => block.text).join('')
			}

			return { content: text }
		},

		// 结构化的多模态调用（DeepSeek 只支持文本）
		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @param {import('../../../decl/AIsource.ts').GenerationOptions} [options] - 生成选项。
		 * @returns {Promise<{content: string, files: any[]}>} 来自 AI 的结果。
		 */
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct, options = {}) => {
			const { base_result = {}, replyPreviewUpdater, signal } = options

			// Check for abort before starting
			if (signal?.aborted) {
				const err = new Error('Aborted by user')
				err.name = 'AbortError'
				throw err
			}

			// 使用 fount 工具函数获取独立的系统提示
			const system_prompt = structPromptToSingleNoChatLog(prompt_struct)

			// 使用 fount 工具函数合并聊天记录，并转换为 DeepSeek API 格式（基于 Anthropic API）
			const messages = await Promise.all(margeStructPromptChatLog(prompt_struct).map(async chatLogEntry => {
				const role = chatLogEntry.role === 'user' || chatLogEntry.role === 'system' ? 'user' : 'assistant'

				// 内容数组（DeepSeek 目前只支持文本）
				const content = []

				const uid = Math.random().toString(36).slice(2, 10)

				// 添加文本内容
				content.push({
					type: 'text',
					text: `\
<message "${uid}">
<sender>${chatLogEntry.name}</sender>
<content>
${chatLogEntry.content}
</content>
</message "${uid}">
`,
				})

				// DeepSeek 目前不支持图片输入
				if (chatLogEntry.files && chatLogEntry.files.length > 0) {
					console.warn('DeepSeek API does not support image input. Files will be ignored.')
				}

				return { role, content }
			}))

			// 构建最终的 API 请求参数
			const params = {
				model: config.model,
				system: system_prompt,
				messages,
				...config.model_arguments,
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
						).join('|')})\s*<\/sender>\s*<content>`
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

			// Use streaming based on config
			const useStream = (config.use_stream ?? true) && !!replyPreviewUpdater

			if (useStream) {
				const stream = await client.messages.create({ ...params, stream: true, signal })
				for await (const event of stream) {
					if (signal?.aborted) {
						const err = new Error('Aborted by user')
						err.name = 'AbortError'
						throw err
					}
					if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
						result.content += event.delta.text
						previewUpdater(result)
					}
				}
			}
			else {
				const message = await client.messages.create({ ...params, signal })
				result.content = message.content.filter(block => block.type === 'text').map(block => block.text).join('')
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
			 * @returns {number} 令牌数。
			 */
			get_token_count: prompt => prompt?.length ?? 0,
		}
	}
	return result
}
