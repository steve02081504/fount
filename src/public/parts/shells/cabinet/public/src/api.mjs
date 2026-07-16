const API = '/api/parts/shells:cabinet'

/**
 * @param {string} method HTTP 方法
 * @param {string} path 路径
 * @param {object} [body] body
 * @param {Record<string, string>} [headers] 额外头
 * @returns {Promise<any>} JSON
 */
export async function api(method, path, body, headers = {}) {
	const res = await fetch(`${API}${path}`, {
		method,
		credentials: 'include',
		headers: {
			...body ? { 'Content-Type': 'application/json' } : {},
			...headers,
		},
		body: body ? JSON.stringify(body) : undefined,
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || err.message || `${method} ${path} ${res.status}`)
	}
	if (res.headers.get('Content-Type')?.includes('application/zip'))
		return res.blob()
	return res.json()
}

/**
 * @param {string} unlockToken token
 * @returns {Record<string, string>} headers
 */
export function unlockHeaders(unlockToken) {
	return unlockToken ? { 'X-Cabinet-Unlock': unlockToken } : {}
}
