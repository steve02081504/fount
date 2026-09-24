/**
 * 文本化 content（结构化 content 序列化为 JSON 字符串）。
 * @param {any} content - 消息 content。
 * @returns {string} 文本。
 */
function contentToText(content) {
	return typeof content === 'string' ? content : JSON.stringify(content)
}

/**
 * 图片 MIME → Converse image.format。
 * @param {string} mimeType - 基础 MIME。
 * @returns {string} Converse 图片格式。
 */
function converseImageFormat(mimeType) {
	const map = {
		'image/jpeg': 'jpeg',
		'image/jpg': 'jpeg',
		'image/png': 'png',
		'image/gif': 'gif',
		'image/webp': 'webp',
	}
	return map[String(mimeType || '').split(';')[0].trim().toLowerCase()] ?? 'png'
}

/**
 * 非 system 消息的 content → Converse content 块。
 * `binaryMode='buffer'` 时结构化 content 保留为 Converse content 块（图片 bytes 为 Buffer），
 * 否则整体序列化为单个 text 块（真实出站行为）。
 * @param {any} content - 消息 content。
 * @param {'base64' | 'buffer'} binaryMode - 二进制模式。
 * @returns {Array<object>} Converse content 块。
 */
function contentToConverseBlocks(content, binaryMode) {
	if (typeof content === 'string') return [{ text: content }]
	if (binaryMode !== 'buffer') return [{ text: JSON.stringify(content) }]
	return content.map(part => {
		if (part?.type === 'image_url' && part.image_url?.data)
			return {
				image: {
					format: converseImageFormat(part.image_url.mime_type),
					source: { bytes: part.image_url.data },
				},
			}
		if (part?.type === 'text') return { text: part.text }
		return { text: JSON.stringify(part) }
	})
}

/**
 * 把 OpenAI 消息转成 Bedrock Converse 入参。
 * @param {Array<{role: string, content: any}>} messages - chat 消息。
 * @param {{ binaryMode?: 'base64' | 'buffer' }} [options] - `binaryMode='buffer'` 时保留结构化 content 与 Buffer 字节（供 BuildPrompt 快照），默认序列化为文本（真实出站）。
 * @returns {{ system: Array<{text: string}>, messages: Array<{role: string, content: Array<object>}> }} Converse 字段。
 */
export function messagesToConverse(messages, options = {}) {
	const binaryMode = options.binaryMode ?? 'base64'
	const system = []
	const converseMessages = []
	for (const message of messages) {
		if (message.role === 'system') {
			system.push({ text: contentToText(message.content) })
			continue
		}
		converseMessages.push({
			role: message.role === 'assistant' ? 'assistant' : 'user',
			content: contentToConverseBlocks(message.content, binaryMode),
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
