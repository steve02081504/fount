/**
 * 根据用户粘贴的 API 地址生成 chat completions 候选 URL。
 *
 * - 已含 `/chat/completions`：原样使用
 * - 以 `/v1` 结尾：只补 `/chat/completions`（避免拼出 `/v1/v1/...`）
 * - 其它基址：先试原 URL，再试 `/v1/chat/completions`、`/chat/completions`
 *
 * @param {string} url - 用户配置的 API URL。
 * @returns {string[]} 按优先级排列的候选 URL。
 */
export function completionsUrlCandidates(url) {
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

	if (path.includes('/chat/completions')) return [urlObj.href]

	/**
	 * @param {string} pathname
	 * @returns {string}
	 */
	const withPath = (pathname) => {
		const next = new URL(urlObj)
		next.pathname = pathname
		return next.href
	}

	if (path.endsWith('/v1'))
		return [withPath(`${path}/chat/completions`)]

	return [
		urlObj.href,
		withPath(`${path}/v1/chat/completions`),
		withPath(`${path}/chat/completions`),
	]
}
