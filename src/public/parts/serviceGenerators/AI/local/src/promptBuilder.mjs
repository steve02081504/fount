/**
 * 本地 GGUF 源出站消息的纯构建逻辑。
 * 供 StructCall 与 BuildPrompt 共用；不加载模型、不触网。
 */
import { mergeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../../../shells/chat/src/prompt_struct/index.mjs'

/**
 * 结构化提示类型别名。
 * @typedef {import('../../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t
 */

/**
 * 构建聊天消息
 * @param {prompt_struct_t} prompt_struct - 结构化提示。
 * @param {object} config - 配置。
 * @returns {Array<{role: string, content: string}>} 供 Llama 会话使用的 role/content 消息数组。
 */
export function buildChatMessages(prompt_struct, config) {
	const messages = mergeStructPromptChatLog(prompt_struct).map(chatLogEntry => {
		const images = (chatLogEntry.files || [])
			.filter(file => file.mime_type && file.mime_type.startsWith('image/'))
		let { content } = chatLogEntry
		if (images.length)
			content += '\n' + images.map(() => '[local GGUF: image input omitted]').join('\n')
		return {
			role: chatLogEntry.role === 'user' ? 'user' : chatLogEntry.role === 'system' ? 'system' : 'assistant',
			content,
		}
	})

	const system_prompt = structPromptToSingleNoChatLog(prompt_struct)
	if (system_prompt) {
		const systemMessage = { role: 'system', content: system_prompt }
		if (config.system_prompt_at_depth && config.system_prompt_at_depth < messages.length)
			messages.splice(Math.max(messages.length - config.system_prompt_at_depth, 0), 0, systemMessage)
		else
			messages.unshift(systemMessage)
	}

	if (config.convert_config?.roleReminding ?? true) {
		const isMultiChar = new Set(prompt_struct.chat_log.map(e => e.name).filter(Boolean)).size > 2
		if (isMultiChar)
			messages.push({
				role: 'system',
				content: `Now, please continue the conversation as ${prompt_struct.Charname}.`
			})
	}

	return messages
}

/**
 * 按本源配置构建本地 GGUF 出站结构（图片不发送，仅以占位说明）。
 * @param {prompt_struct_t} prompt_struct - 结构化提示。
 * @param {object} config - 配置。
 * @returns {{messages: Array<{role: string, content: string}>}} 出站结构。
 */
export function buildLocalPromptStruct(prompt_struct, config) {
	return { messages: buildChatMessages(prompt_struct, config) }
}
