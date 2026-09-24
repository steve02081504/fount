import { mergeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../../shells/chat/src/prompt_struct/index.mjs'

/**
 * 将 prompt_struct 构建成 Ollama chat 消息数组（供 StructCall 与 BuildPrompt 共用）。
 * @param {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct - 结构化提示。
 * @param {object} config - 当前服务配置。
 * @param {{ binaryMode?: 'base64' | 'buffer' }} [options] - `binaryMode='buffer'` 时图片保留为 Buffer（供 BuildPrompt 快照），默认 `'base64'`（真实出站）。
 * @returns {Array<{role: 'user'|'assistant'|'system', content: string, images?: (string|Uint8Array)[]}>} 消息数组。
 */
export function buildOllamaMessages(prompt_struct, config, options = {}) {
	const binaryMode = options.binaryMode ?? 'base64'
	const messages = mergeStructPromptChatLog(prompt_struct).map(chatLogEntry => {
		const images = (chatLogEntry.files || [])
			.filter(file => file.mime_type && file.mime_type.startsWith('image/'))
			.map(file => binaryMode === 'buffer' ? file.buffer : file.buffer.toString('base64'))

		/**
		 * Ollama 消息对象。
		 * @type {{role: 'user'|'assistant'|'system', content: string, images?: (string|Uint8Array)[]}}
		 */
		const message = {
			role: chatLogEntry.role === 'user' ? 'user' : chatLogEntry.role === 'system' ? 'system' : 'assistant',
			content: chatLogEntry.content,
		}
		if (images.length) message.images = images

		return message
	})

	const system_prompt = structPromptToSingleNoChatLog(prompt_struct)
	if (system_prompt) {
		const systemMessage = {
			role: 'system',
			content: system_prompt
		}
		if (config.system_prompt_at_depth && config.system_prompt_at_depth < messages.length)
			messages.splice(Math.max(messages.length - config.system_prompt_at_depth, 0), 0, systemMessage)
		else
			messages.unshift(systemMessage)
	}

	if (config.convert_config?.roleReminding ?? true) {
		const isMultiChar = new Set(prompt_struct.chat_log.map(chatLogEntry => chatLogEntry.name).filter(Boolean)).size > 2
		if (isMultiChar)
			messages.push({
				role: 'system',
				content: `Now, please continue the conversation as ${prompt_struct.Charname}.`
			})
	}

	return messages
}
