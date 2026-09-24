/**
 * Claude cookie/web 出站消息与 prompt 字符串的纯构建逻辑。
 * 供 StructCall 与 BuildPrompt 共用；不触网。
 */
import { structPromptToSingleNoChatLog } from '../../../shells/chat/src/prompt_struct/index.mjs'

/**
 * 结构化提示类型别名。
 * @typedef {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t
 */

/**
 * 把 prompt_struct 转成 Claude 出站的 role/content 消息数组（每条聊天记录包成 <message>）。
 * @param {prompt_struct_t} prompt_struct - 结构化提示。
 * @returns {Array<{role: string, content: string}>} 消息数组（system 置顶）。
 */
export function buildClaudeMessages(prompt_struct) {
	const messages = []
	prompt_struct.chat_log.forEach(chatLogEntry => {
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

	const system_prompt = structPromptToSingleNoChatLog(prompt_struct)
	if (system_prompt)
		messages.unshift({
			role: 'system',
			content: system_prompt
		})

	return messages
}

/**
 * 把 role/content 消息数组拼成 Claude 出站 prompt 字符串。
 * @param {Array<{role: string, content: string}>} messages - 消息数组。
 * @returns {string} prompt 字符串（以 `Assistant:` 收尾）。
 */
export function buildClaudePrompt(messages) {
	return messages.map(chatMessage => `${chatMessage.role}: ${chatMessage.content}`).join('\n\n') + '\n\nAssistant:'
}
