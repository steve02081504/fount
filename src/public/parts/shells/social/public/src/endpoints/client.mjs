/**
 * Social 前端 HTTP 客户端底座（私有：仅供 `endpoints/*.mjs` 内部使用，UI 不得直接导入）。
 */

/** Social shell HTTP API 根路径（供 `emojiPackItemUrl` 等需要拼 URL 而非请求的场景）。 */
export const SOCIAL_BASE = '/api/parts/shells:social'
const CHAT_BASE = '/api/parts/shells:chat'

/**
 * @param {string} base API 前缀
 * @param {string} path 路径（含前导 `/`）
 * @param {object} [options] fetch 选项
 * @returns {Promise<any>} JSON
 */
async function request(base, path, options = {}) {
	const response = await fetch(`${base}${path}`, {
		credentials: 'include',
		headers: { 'Content-Type': 'application/json', ...options.headers },
		...options,
	})
	if (!response.ok) throw new Error(await response.text())
	return response.json()
}

/**
 * 调用 Social shell 受保护 HTTP API 并返回 JSON。
 * @param {string} path API 路径（含前导 `/`）
 * @param {object} [options] fetch 选项
 * @returns {Promise<any>} 解析后的 JSON
 */
export function socialRequest(path, options = {}) {
	return request(SOCIAL_BASE, path, options)
}

/**
 * 调用 Chat shell 受保护 HTTP API（Social 复用 viewer / personal-lists / entities/search / translation-prefs）。
 * @param {string} path API 路径（含前导 `/`）
 * @param {object} [options] fetch 选项
 * @returns {Promise<any>} 解析后的 JSON
 */
export function chatRequest(path, options = {}) {
	return request(CHAT_BASE, path, options)
}
