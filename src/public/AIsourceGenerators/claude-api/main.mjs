
import Anthropic from 'npm:@anthropic-ai/sdk'
import { escapeRegExp } from '../../../scripts/escape.mjs'
import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/prompt_struct.mjs'
import info from './info.json' assert { type: 'json' }
import info_dynamic from './info.dynamic.json' assert { type: 'json' }
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

// 支持的图片 MIME 类型列表
const supportedImageTypes = [
	'image/jpeg',
	'image/png',
	'image/gif',
	'image/webp',
]


const configTemplate = {
	name: 'claude-api-sonnet',
	// 存储 API 密钥，可以是字符串或 null
	api_key: null,
	// 使用的模型名称
	model: 'claude-3-5-sonnet-20240620',
	// 是否使用流式传输
	use_stream: true,
	// 传递给模型创建请求的其他参数
	model_arguments: {
		max_tokens: 4096,
		temperature: 1
	}
}
/**
 * 获取 AI 源。
 * @param {object} config - 配置对象。
 * @returns {Promise<AIsource_t>} AI 源。
 */
async function GetSource(config) {
	// 初始化 Anthropic 客户端
	const client = new Anthropic({
		apiKey: config.api_key
	})
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
				// Claude 的响应 content 是一个数组，我们只取文本部分
				text = message.content.filter(block => block.type === 'text').map(block => block.text).join('')
			}

			return { content: text }
		},

		// 结构化的多模态调用
		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @returns {Promise<{content: string, files: any[]}>} 来自 AI 的结果。
		 */
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			// 使用 fount 工具函数获取独立的系统提示
			const system_prompt = structPromptToSingleNoChatLog(prompt_struct)

			// 使用 fount 工具函数合并聊天记录，并转换为 Claude 的格式
			const messages = await Promise.all(margeStructPromptChatLog(prompt_struct).map(async chatLogEntry => {
				const role = chatLogEntry.role === 'user' || chatLogEntry.role === 'system' ? 'user' : 'assistant'

				// 内容可以是文本和图片的混合数组
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

				// 处理并添加文件内容（仅限图片）
				if (chatLogEntry.files)
					for (const file of chatLogEntry.files) {
						const mime_type = file.mime_type || mime.lookup(file.name) || 'application/octet-stream'
						if (supportedImageTypes.includes(mime_type))
							try {
								content.push({
									type: 'image',
									source: {
										type: 'base64',
										media_type: mime_type,
										data: file.buffer.toString('base64'),
									}
								})
							}
							catch (error) {
								console.error(`Failed to process image file ${file.name}:`, error)
								// 如果处理失败，可以添加一条错误信息文本
								content.push({
									type: 'text',
									text: `[System Error: Failed to process image file ${file.name}]`,
								})
							}
						else {
							console.warn(`Unsupported file type for Claude: ${mime_type} for file ${file.name}. Skipping.`)
							content.push({
								type: 'text',
								text: `[System Info: File ${file.name} with type ${mime_type} was skipped as it is not a supported image format.]`
							})
						}
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

			let text = ''
			const files = [] // 用于存放模型生成的图片（如果未来支持）

			if (config.use_stream) {
				const stream = await client.messages.create({ ...params, stream: true })
				for await (const event of stream)
					if (event.type === 'content_block_delta' && event.delta.type === 'text_delta')
						text += event.delta.text
			}
			else {
				const message = await client.messages.create(params)
				text = message.content.filter(block => block.type === 'text').map(block => block.text).join('')
			}

			if (text.match(/<\/sender>\s*<content>/))
				text = text.match(/<\/sender>\s*<content>([\S\s]*)<\/content>/)[1].split(new RegExp(
					`(${(prompt_struct.alternative_charnames || []).map(Object).map(
						stringOrReg => {
							if (stringOrReg instanceof String) return escapeRegExp(stringOrReg)
							return stringOrReg.source
						}
					).join('|')
					})\\s*<\\/sender>\\s*<content>`
				)).pop().split(/<\/content>\s*<\/message/).shift()
			if (text.match(/<\/content>\s*<\/message[^>]*>\s*$/))
				text = text.split(/<\/content>\s*<\/message[^>]*>\s*$/).shift()

			return {
				content: text,
				files,
			}
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
