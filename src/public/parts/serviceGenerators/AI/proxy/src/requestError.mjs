/**
 * AI 源请求失败的统一错误类型。
 *
 * 过去失败响应被直接以普通对象（`{data, response}`）或拼好的字符串抛出，导致上层
 * `GetReply` 捕获到「非 Error」。此处统一成真正的 `Error` 实例，并保留状态码、URL、
 * API 风格与原始载荷，便于回退判断与展示。
 */

/**
 * AI 源请求失败。
 */
export class AIRequestError extends Error {
	/**
	 * @param {string} message - 错误信息。
	 * @param {object} [info] - 结构化信息。
	 * @param {number} [info.status] - HTTP 状态码。
	 * @param {string} [info.url] - 请求 URL。
	 * @param {'chat'|'responses'} [info.apiStyle] - API 风格。
	 * @param {any} [info.data] - 解析后的错误载荷。
	 * @param {string} [info.text] - 原始响应文本。
	 * @param {Response} [info.response] - 原始响应对象。
	 */
	constructor(message, { status, url, apiStyle, data, text, response } = {}) {
		super(message)
		this.name = 'AIRequestError'
		if (status != null) this.status = status
		if (url != null) this.url = url
		if (apiStyle != null) this.apiStyle = apiStyle
		if (data !== undefined) this.data = data
		if (text !== undefined) this.text = text
		if (response !== undefined) this.response = response
	}
}

/**
 * 从失败的 HTTP 响应构造 `AIRequestError`。
 * @param {Response} response - 失败的响应。
 * @param {{url?: string, apiStyle?: 'chat'|'responses'}} [context] - 请求上下文。
 * @returns {Promise<AIRequestError>} 统一错误。
 */
export async function readErrorResponse(response, { url, apiStyle } = {}) {
	let text = ''
	try {
		text = await response.text()
	}
	catch {
		// 读取失败时保留空文本
	}
	let data
	try {
		data = JSON.parse(text)
	}
	catch {
		// 非 JSON 时保留原始文本
	}
	const detail = data?.error?.message ?? data?.message ?? text ?? ''
	const where = [apiStyle, response.status, url].filter(Boolean).join(' ')
	return new AIRequestError(
		`${where}${detail ? `: ${detail}` : ''}`,
		{ status: response.status, url, apiStyle, data, text, response },
	)
}

/**
 * 判断某个候选端点的失败是否值得尝试下一个候选。
 *
 * 只有「端点不对」才回退：网络层失败，或 404 / 405 / 501。内容错误（400 / 401 /
 * 403 / 413 / 422 / 429 / 5xx）说明端点是对的、请求本身有问题，继续换端点只会放大
 * 请求量并掩盖真正的错误。
 * @param {any} error - 抛出的错误。
 * @returns {boolean} 是否应尝试下一个候选。
 */
export function isRetryableCandidateError(error) {
	if (error instanceof AIRequestError) return [404, 405, 501].includes(error.status)
	return error instanceof TypeError
}
