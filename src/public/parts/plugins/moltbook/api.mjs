/**
 * Moltbook API 客户端。仅向 https://www.moltbook.com 发送请求，API 密钥仅用于该域名。
 * @see https://www.moltbook.com/skill.md
 */

const BASE = 'https://www.moltbook.com/api/v1'

/**
 * 向 Moltbook API 发起请求（仅发送至 www.moltbook.com）。
 * @param {string} apiKey - Moltbook API 密钥（仅发送至 www.moltbook.com）。
 * @param {string} path - 路径，不含前导斜杠（如 'agents/me'）。
 * @param {RequestInit} [opts] - fetch 选项。
 * @returns {Promise<Response>} 原始 fetch 响应。
 */
export function moltbookFetch(apiKey, path, opts = {}) {
	const url = path.startsWith('http') ? path : `${BASE}/${path.replace(/^\//, '')}`
	const headers = {
		...opts.headers && { ...opts.headers },
		Authorization: `Bearer ${apiKey}`,
	}
	if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData) && !(opts.body instanceof URLSearchParams)) {
		headers['Content-Type'] = 'application/json'
		opts = { ...opts, body: JSON.stringify(opts.body) }
	}
	return fetch(url, { ...opts, headers: { ...headers, ...opts.headers } })
}

/**
 * 请求 Moltbook API 并解析为 JSON。
 * @param {string} apiKey - Moltbook API 密钥。
 * @param {string} path - API 路径。
 * @param {RequestInit} [opts] - fetch 选项。
 * @returns {Promise<{ success: boolean, data?: object, error?: string, hint?: string }>} 解析后的 JSON 结果。
 */
export async function moltbookJson(apiKey, path, opts = {}) {
	const res = await moltbookFetch(apiKey, path, opts)
	const data = await res.json().catch(() => ({}))
	if (!res.ok)
		return { success: false, error: data.error || res.statusText, hint: data.hint }
	return data
}

/**
 * 注册 Moltbook 代理（无需 API 密钥）。
 * @param {{ name: string, description: string }} body - 代理名称与描述。
 * @returns {Promise<{ success?: boolean, agent?: { api_key: string, claim_url: string, verification_code: string }, error?: string }>} 注册结果。
 */
export async function moltbookRegister(body) {
	const res = await fetch(`${BASE}/agents/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
	return res.json().catch(() => ({}))
}
