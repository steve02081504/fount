import { mergeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../../../shells/chat/src/prompt_struct/index.mjs'

/**
 * 将 prompt_struct 构建成带 XML 信封的纯文本消息数组。
 * grok / duckduckgo / blackbox / notdiamond 等不支持附件的源共用；`indent` 用于保留各源历史实现的信封缩进。
 * @param {import('../../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct - 结构化提示。
 * @param {{ systemPromptAtDepth?: number, roleReminding?: boolean, indent?: string }} [options] - 已解析的配置。
 * @returns {Array<{role: 'user'|'assistant'|'system', content: string}>} 消息数组。
 */
export function buildEnvelopeChatMessages(prompt_struct, options = {}) {
	const { systemPromptAtDepth, roleReminding = true, indent = '' } = options
	const messages = []
	mergeStructPromptChatLog(prompt_struct).forEach(chatLogEntry => {
		const uid = chatLogEntry.id ||= crypto.randomUUID().slice(0, 8)
		messages.push({
			role: chatLogEntry.role === 'user' ? 'user' : chatLogEntry.role === 'system' ? 'system' : 'assistant',
			content: `${indent}<message "${uid}">
${indent}<sender>${chatLogEntry.name}</sender>
${indent}<content>
${indent}${chatLogEntry.content}
${indent}</content>
${indent}</message "${uid}">
${indent}`
		})
	})

	const system_prompt = structPromptToSingleNoChatLog(prompt_struct)
	if (systemPromptAtDepth)
		messages.splice(Math.max(messages.length - systemPromptAtDepth, 0), 0, {
			role: 'system',
			content: system_prompt
		})
	else
		messages.unshift({
			role: 'system',
			content: system_prompt
		})

	if (roleReminding) {
		const isMultiChar = new Set(prompt_struct.chat_log.map(chatLogEntry => chatLogEntry.name).filter(Boolean)).size > 2
		if (isMultiChar)
			messages.push({
				role: 'system',
				content: `现在请以${prompt_struct.Charname}的身份续写对话。`
			})
	}

	return messages
}
