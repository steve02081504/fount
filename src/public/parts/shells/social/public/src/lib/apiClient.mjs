/** Social shell HTTP 客户端。 */
import { socialState } from '../state.mjs'

/**
 *
 */
export const SOCIAL_API = '/api/parts/shells:social'

/**
 *
 */
export const CHAT_API = '/api/parts/shells:chat'

/**
 * 调用 Social shell 受保护 HTTP API 并返回 JSON。
 * @param {string} path API 路径（含前导 `/`）
 * @param {object} [options] fetch 选项
 * @returns {Promise<any>} 解析后的 JSON
 */
export async function socialApi(path, options = {}) {
	const response = await fetch(`${SOCIAL_API}${path}`, {
		credentials: 'include',
		headers: { 'Content-Type': 'application/json', ...options.headers || {} },
		...options,
	})
	if (!response.ok) throw new Error(await response.text())
	return response.json()
}

/**
 * 调用 Chat shell 受保护 HTTP API（Social 复用 viewer / personal-lists / entities/search / translation-prefs）。
 * @param {string} path API 路径（含前导 `/`）
 * @param {object} [options] fetch 选项
 * @returns {Promise<any>} 解析后的 JSON
 */
export async function chatApi(path, options = {}) {
	const response = await fetch(`${CHAT_API}${path}`, {
		credentials: 'include',
		headers: { 'Content-Type': 'application/json', ...options.headers || {} },
		...options,
	})
	if (!response.ok) throw new Error(await response.text())
	return response.json()
}

/**
 * @returns {string | null} 当前观看者（operator）entityHash
 */
export function viewerEntityHash() {
	return socialState.viewerEntityHash
}
