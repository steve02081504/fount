import { AIRequestError, readErrorResponse } from '../../proxy/src/requestError.mjs'
import { createUsageRecorder } from '../../proxy/src/usage.mjs'

/**
 * 把 chat 的 content part 转成 Responses 的对应 type。
 * @param {object} part - chat content part。
 * @param {'user'|'assistant'|'system'} role - 所属消息角色。
 * @returns {object} Responses content part。
 */
function convertContentPart(part, role) {
	if (part?.type === 'text')
		return { type: role === 'assistant' ? 'output_text' : 'input_text', text: part.text }
	if (part?.type === 'image_url')
		return {
			type: 'input_image',
			image_url: typeof part.image_url === 'string' ? part.image_url : part.image_url?.url ?? part.image_url,
		}
	return part
}

/**
 * 拆分 assistant content：Responses 的 assistant 回合只接受 output_text / refusal，
 * 其余 part（附件）必须移到紧随其后的 user 消息，否则严格后端会 400。
 * @param {object[]} content - assistant content parts。
 * @returns {{ allowed: object[], spill: object[] }} assistant 合法 part 与需外移的 part。
 */
function splitAssistantContent(content) {
	const allowed = []
	const spill = []
	for (const part of content)
		if (part?.type === 'text') allowed.push({ type: 'output_text', text: part.text })
		else if (part?.type === 'refusal') allowed.push(part)
		else spill.push(convertContentPart(part, 'user'))
	return { allowed, spill }
}

/**
 * 把 OpenAI chat 消息转成 Responses API body。
 *
 * system 消息内联进 `input`（role: 'system'），保留其在历史中的深度位置；不再统一
 * 提到顶层 `instructions`。
 * @param {Array<{role: string, content: any}>} messages - chat 消息。
 * @param {object} options - 请求选项。
 * @param {string} options.model - 模型。
 * @param {boolean} [options.stream] - 是否流式。
 * @param {object} [options.model_arguments] - 额外参数。
 * @returns {object} Responses 请求体。
 */
export function messagesToResponsesBody(messages, { model, stream, model_arguments }) {
	const input = []

	for (const message of messages) {
		const role = message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user'

		if (role === 'assistant' && Array.isArray(message.content)) {
			const { allowed, spill } = splitAssistantContent(message.content)
			input.push({ type: 'message', role: 'assistant', content: allowed })
			if (spill.length) input.push({ type: 'message', role: 'user', content: spill })
			continue
		}

		// 严格 Responses 后端会把带 type 的 assistant 消息按 ResponseOutputMessage 校验，
		// 字符串 content 会被逐字符迭代而 400；多轮回传的 assistant 内容必须序列化为 output_text 内容块。
		const content = Array.isArray(message.content)
			? message.content.map(part => convertContentPart(part, role))
			: role === 'assistant'
				? [{ type: 'output_text', text: message.content }]
				: message.content
		input.push({ type: 'message', role, content })
	}

	return {
		model,
		stream: !!stream,
		store: false,
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
 * 把 Responses `output` 数组里的 reasoning summary 追加进结果的 extension。
 * 流式/非流式的 `reasoning_summary_text.delta` 与 `reasoning` item 共用此形状。
 * @param {{extension?: object}} result - 累积结果。
 * @param {number} index - summary 段索引。
 * @param {string} text - 追加文本。
 * @returns {void}
 */
function appendReasoningSummary(result, index, text) {
	if (!text) return
	result.extension ??= {}
	result.extension.reasoning_summary ??= []
	while (result.extension.reasoning_summary.length <= index)
		result.extension.reasoning_summary.push('')
	result.extension.reasoning_summary[index] += text
}

/**
 * POST Responses API 并解析流式/非流式输出。
 * @param {object} args - 参数。
 * @param {string} args.url - 端点。
 * @param {Record<string, string>} args.headers - 请求头。
 * @param {object} [args.usageConfig] - 用量定价配置。
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
	usageConfig = {},
	signal,
	previewUpdater = () => { },
	result = { content: '', files: [] },
}) {
	const usageRecorder = createUsageRecorder(result, { ...usageConfig, model: body.model })
	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...headers },
			body: JSON.stringify(body),
			signal,
		})
		if (!response.ok)
			throw await readErrorResponse(response, { url, apiStyle: 'responses' })

		if (!body.stream) {
			const json = await response.json()
			usageRecorder.record(json.usage, json.model)
			if (json.error)
				throw new AIRequestError(
					`responses error: ${json.error.message ?? JSON.stringify(json.error)}`,
					{ url, apiStyle: 'responses', data: json },
				)
			result.content = textFromResponsesJson(json)
			let reasoningIndex = 0
			for (const item of json.output ?? [])
				if (item.type === 'reasoning')
					for (const summary of item.summary ?? [])
						if (summary.type === 'summary_text') appendReasoningSummary(result, reasoningIndex++, summary.text)
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

		/**
		 * 处理一行 SSE `data:`。
		 * @param {string} line - 原始行。
		 * @returns {void}
		 */
		const handleLine = line => {
			const trimmed = line.trim()
			if (!trimmed.startsWith('data:')) return
			const data = trimmed.slice(5).trim()
			if (!data || data === '[DONE]') return

			let json
			try {
				json = JSON.parse(data)
			} catch (error) {
				console.warn('Error parsing responses stream data:', error)
				return
			}

			usageRecorder.record(json.response?.usage ?? json.usage, json.response?.model ?? json.model)

			// 失败事件：过去被静默忽略，导致得到空回复。
			if (json.type === 'error' || json.type === 'response.failed') {
				const failed = json.error ?? json.response?.error ?? json
				throw new AIRequestError(
					`responses stream error: ${failed?.message ?? JSON.stringify(failed)}`,
					{ url, apiStyle: 'responses', data: json },
				)
			}
			// 顶层直接挂 error 对象的来源
			if (json.error)
				throw new AIRequestError(
					`responses stream error: ${json.error.message ?? JSON.stringify(json.error)}`,
					{ url, apiStyle: 'responses', data: json },
				)

			if (json.delta && ['response.output_text.delta', 'response.refusal.delta', 'response.reasoning_summary_text.delta', 'response.function_call_arguments.delta'].includes(json.type)) usageRecorder.firstOutput()

			if (json.type === 'response.output_text.delta') {
				result.content += json.delta ?? ''
				previewUpdater(result)
			}
			else if (json.type === 'response.refusal.delta') {
				result.content += json.delta ?? ''
				previewUpdater(result)
			}
			else if (json.type === 'response.reasoning_summary_text.delta') {
				appendReasoningSummary(result, json.summary_index ?? json.content_index ?? 0, json.delta ?? '')
				previewUpdater(result)
			}
			else if (json.type === 'response.completed' && json.response)
				result.content ||= textFromResponsesJson(json.response)
		}

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
				for (const line of lines) handleLine(line)
			}
			// 冲刷解码器与最后一行（流末尾可能没有换行结尾）。
			buffer += decoder.decode()
			for (const line of buffer.split('\n')) handleLine(line)
		}
		finally {
			reader.releaseLock()
		}
		return result
	}
	catch (error) {
		// 失败/中断同样结算：已上报的计量与请求区间都要留下
		usageRecorder.fail(error)
		throw error
	}
	finally { usageRecorder.apply() }
}
