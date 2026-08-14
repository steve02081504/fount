/**
 * 测试用 fetch 替换。
 * @param {(request: {url: string, init?: RequestInit}) => (Response | Promise<Response>)} handler - 假响应。
 * @returns {{ calls: Array<{url: string, init?: RequestInit}>, restore: () => void }} 记录与还原。
 */
export function mockJsonFetch(handler) {
	const calls = []
	const originalFetch = globalThis.fetch
	/**
	 * 记下请求并交给 handler。
	 * @param {string | URL} url - 请求 URL。
	 * @param {RequestInit} [init] - fetch 选项。
	 * @returns {Promise<Response>} 假响应。
	 */
	globalThis.fetch = async (url, init) => {
		const request = { url: String(url), init }
		calls.push(request)
		return handler(request)
	}
	return {
		calls,
		/**
		 * 还原 fetch。
		 * @returns {void}
		 */
		restore: () => {
			globalThis.fetch = originalFetch
		},
	}
}

/**
 * 非流式 OpenAI chat completions 假响应。
 * @param {string} content - 回复文本。
 * @returns {Response} 响应。
 */
export function openaiMessageResponse(content) {
	return new Response(JSON.stringify({
		choices: [{ message: { content } }],
	}), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

/**
 * 非流式 Responses 假响应。
 * @param {string} content - 回复文本。
 * @returns {Response} 响应。
 */
export function responsesOutputResponse(content) {
	return new Response(JSON.stringify({ output_text: content }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	})
}
