/**
 * 把 OpenAI chat 消息转成 Responses API body。
 * @param {Array<{role: string, content: any}>} messages - chat 消息。
 * @param {object} options - 请求选项。
 * @param {string} options.model - 模型。
 * @param {boolean} [options.stream] - 是否流式。
 * @param {object} [options.model_arguments] - 额外参数。
 * @returns {object} Responses 请求体。
 */
export function messagesToResponsesBody(messages, { model, stream, model_arguments }) {
	const instructions = messages
		.filter(message => message.role === 'system')
		.map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content))
		.join('\n')
	const input = messages
		.filter(message => message.role !== 'system')
		.map(message => ({
			type: 'message',
			role: message.role === 'assistant' ? 'assistant' : 'user',
			content: message.content,
		}))
	return {
		model,
		stream: !!stream,
		store: false,
		...instructions ? { instructions } : {},
		input,
		...model_arguments,
	}
}

/**
 * 从 Responses JSON 抽出文本。
 * @param {object} json - 响应 JSON。
 * @returns {string} 文本。
 */
export function textFromResponsesJson(json) {
	if (typeof json.output_text === 'string') return json.output_text
	let text = ''
	for (const item of json.output ?? [])
		if (item.type === 'message')
			for (const part of item.content ?? [])
				if (part.type === 'output_text') text += part.text ?? ''
	return text
}

/**
 * POST Responses API 并解析流式/非流式输出。
 * @param {object} args - 参数。
 * @param {string} args.url - 端点。
 * @param {Record<string, string>} args.headers - 请求头。
 * @param {object} args.body - JSON body。
 * @param {AbortSignal} [args.signal] - 取消。
 * @param {(result: {content: string, files: any[]}) => void} [args.previewUpdater] - 预览。
 * @param {{content: string, files: any[], extension?: object}} [args.result] - 累积结果。
 * @returns {Promise<{content: string, files: any[], extension?: object}>} 回复。
 */
export async function fetchResponses({
	url,
	headers,
	body,
	signal,
	previewUpdater = () => { },
	result = { content: '', files: [] },
}) {
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify(body),
		signal,
	})
	if (!response.ok) {
		const text = await response.text()
		throw new Error(`Responses ${response.status}: ${text}`)
	}

	if (!body.stream) {
		const json = await response.json()
		result.content = textFromResponsesJson(json)
		previewUpdater(result)
		return result
	}

	const reader = response.body.getReader()
	signal?.addEventListener?.('abort', () => {
		const err = new Error('User Aborted')
		err.name = 'AbortError'
		reader.cancel(err).catch(() => { })
	}, { once: true })
	const decoder = new TextDecoder()
	let buffer = ''
	try {
		while (true) {
			if (signal?.aborted) {
				const err = new Error('User Aborted')
				err.name = 'AbortError'
				throw err
			}
			const { done, value } = await reader.read()
			if (done) break
			buffer += decoder.decode(value, { stream: true })
			const lines = buffer.split('\n')
			buffer = lines.pop()
			for (const line of lines) {
				const trimmed = line.trim()
				if (!trimmed.startsWith('data:')) continue
				const data = trimmed.slice(5).trim()
				if (!data || data === '[DONE]') continue
				const json = JSON.parse(data)
				if (json.type === 'response.output_text.delta') {
					result.content += json.delta ?? ''
					previewUpdater(result)
				}
				else if (json.type === 'response.completed' && json.response)
					result.content ||= textFromResponsesJson(json.response)
			}
		}
	}
	finally {
		reader.releaseLock()
	}
	return result
}
