/**
 * 根据用户粘贴的 API 地址生成 Responses API 候选 URL。
 *
 * 先把 chat completions 基址归一到「基址」再补 `/responses`：
 * - 已含 `/responses`：原样使用
 * - 去掉尾部 `/chat/completions` 后以 `/v1` 结尾：只补 `/responses`
 * - 其它基址：先试 `/v1/responses`，再试 `/responses`
 *
 * @param {string} url - 用户配置的 API URL（通常是 chat completions 端点）。
 * @returns {string[]} 按优先级排列的候选 URL。
 */
export function responsesUrlCandidates(url) {
	let urlObj
	try {
		urlObj = new URL(url)
	}
	catch {
		return [url]
	}

	// 去尾斜线，并纠正历史错误拼接留下的 /v1/v1/...
	const path = (urlObj.pathname.replace(/\/+$/, '') || '').replace(/\/v1\/v1(?=\/|$)/g, '/v1')
	urlObj.pathname = path || '/'

	if (path.endsWith('/responses')) return [urlObj.href]

	/**
	 * 保留原 URL 的 origin 与查询串，仅替换 pathname。
	 * @param {string} pathname - 目标路径（如 `/v1/responses`）。
	 * @returns {string} 替换 pathname 后的完整 URL。
	 */
	const withPath = (pathname) => {
		const next = new URL(urlObj)
		next.pathname = pathname
		return next.href
	}

	const base = path.replace(/\/chat\/completions$/, '')
	if (base.endsWith('/v1'))
		return [withPath(`${base}/responses`)]

	if (base)
		return [
			withPath(`${base}/v1/responses`),
			withPath(`${base}/responses`),
		]

	return [
		withPath('/v1/responses'),
		withPath('/responses'),
	]
}

/**
 * 判断用户配置的 URL 是否本身就指向 Responses API。
 * @param {string} url - 用户配置的 API URL。
 * @returns {boolean} 是否为 responses 端点。
 */
export function urlImpliesResponses(url) {
	try {
		return /\/responses(?:\/|$)/.test(new URL(url).pathname)
	}
	catch {
		return /\/responses(?:\/|$)/.test(String(url))
	}
}
