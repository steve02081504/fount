/**
 * 将 OpenAI 风格消息转为 node-llama-cpp 的 ChatHistoryItem，并分离最后一次用户输入。
 * @param {Array<{role: string, content: string}>} messages - 不含独立 system 的消息（system 已并入会话选项）。
 * @returns {{ history: Array<{type: string, text?: string, response?: string[]}>, lastUser: string }}
 */
export function splitLastUserPrompt(messages) {
	/** @type {Array<{type: string, text?: string, response?: string[]}>} */
	const history = []
	for (const m of messages) {
		if (m.role === 'user') history.push({ type: 'user', text: String(m.content) })
		else if (m.role === 'assistant') history.push({ type: 'model', response: [String(m.content)] })
	}
	if (history.length === 0) return { history: [], lastUser: '' }
	const last = history[history.length - 1]
	if (last.type !== 'user') {
		return { history, lastUser: '(continue)' }
	}
	history.pop()
	return { history, lastUser: last.text }
}
