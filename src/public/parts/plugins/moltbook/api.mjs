/**
 * Moltbook API 客户端。仅向 https://www.moltbook.com 发送请求，API 密钥仅用于该域名。
 * @see https://www.moltbook.com/skill.md
 */

const BASE = 'https://www.moltbook.com/api/v1'

/**
 * @param {string} apiKey - Moltbook API key (only sent to www.moltbook.com).
 * @param {string} path - Path without leading slash (e.g. 'agents/me').
 * @param {RequestInit} [opts] - fetch options.
 * @returns {Promise<Response>}
 */
export function moltbookFetch(apiKey, path, opts = {}) {
	const url = path.startsWith('http') ? path : `${BASE}/${path.replace(/^\//, '')}`
	const headers = {
		...(opts.headers && { ...opts.headers }),
		Authorization: `Bearer ${apiKey}`,
	}
	if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData) && !(opts.body instanceof URLSearchParams)) {
		headers['Content-Type'] = 'application/json'
		opts = { ...opts, body: JSON.stringify(opts.body) }
	}
	return fetch(url, { ...opts, headers: { ...headers, ...opts.headers } })
}

/**
 * @param {string} apiKey
 * @param {string} path
 * @param {RequestInit} [opts]
 * @returns {Promise<{ success: boolean, data?: object, error?: string, hint?: string }>}
 */
export async function moltbookJson(apiKey, path, opts = {}) {
	const res = await moltbookFetch(apiKey, path, opts)
	const data = await res.json().catch(() => ({}))
	if (!res.ok)
		return { success: false, error: data.error || res.statusText, hint: data.hint }
	return data
}

/**
 * Register agent (no API key required).
 * @param {{ name: string, description: string }} body
 * @returns {Promise<{ success?: boolean, agent?: { api_key: string, claim_url: string, verification_code: string }, error?: string }>}
 */
export async function moltbookRegister(body) {
	const res = await fetch(`${BASE}/agents/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
	return res.json().catch(() => ({}))
}
