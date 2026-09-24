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

/**
 * 模拟严格 Responses 后端（vLLM / LiteLLM 等）：带 `type:'message'` 的 assistant
 * 多轮历史若以字符串为 content，会按 `ResponseOutputMessage` 逐字符校验并返回 400。
 * @param {string} [content] - 合法请求的回复文本。
 * @returns {(request: {url: string, init?: RequestInit}) => Response} mockFetch handler。
 */
export function strictResponsesHandler(content = 'mock-ok') {
	return ({ init }) => {
		const body = JSON.parse(init.body)
		for (const item of body.input ?? [])
			if (item?.type === 'message' && item.role === 'assistant' && !Array.isArray(item.content))
				return new Response(JSON.stringify({
					error: { message: 'Input should be a valid dictionary', param: item.content },
				}), { status: 400, headers: { 'Content-Type': 'application/json' } })
		return responsesOutputResponse(content)
	}
}
