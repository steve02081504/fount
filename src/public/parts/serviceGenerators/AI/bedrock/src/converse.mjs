/**
 * 把 OpenAI 消息转成 Bedrock Converse 入参。
 * @param {Array<{role: string, content: any}>} messages - chat 消息。
 * @returns {{ system: Array<{text: string}>, messages: Array<{role: string, content: Array<{text: string}>}> }} Converse 字段。
 */
export function messagesToConverse(messages) {
	const system = []
	const converseMessages = []
	for (const message of messages) {
		const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
		if (message.role === 'system') {
			system.push({ text })
			continue
		}
		converseMessages.push({
			role: message.role === 'assistant' ? 'assistant' : 'user',
			content: [{ text }],
		})
	}
	return { system, messages: converseMessages }
}

/**
 * 从 Converse 事件抽出增量文本。
 * @param {object} event - ConverseStream 事件。
 * @returns {string} 文本。
 */
export function converseStreamDeltaText(event) {
	return event.contentBlockDelta?.delta?.text ?? ''
}
