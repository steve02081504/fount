const BASE = '/api/parts/shells:subfounts'

/**
 * @param {object} node launchNode 句柄
 * @param {string} method HTTP 方法
 * @param {string} path API 相对路径
 * @param {object} [body] JSON body
 * @returns {Promise<Response>} fetch 响应
 */
export function subfountFetch(node, method, path, body) {
	const sep = path.includes('?') ? '&' : '?'
	const url = `${node.baseUrl}${BASE}${path}${sep}fount-apikey=${encodeURIComponent(node.apiKey)}`
	return fetch(url, {
		method,
		headers: body ? { 'content-type': 'application/json' } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	})
}
