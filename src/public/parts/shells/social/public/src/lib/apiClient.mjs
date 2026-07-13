/** Social shell HTTP 客户端。 */
import { socialState } from '../state.mjs'

/**
 *
 */
export const SOCIAL_API = '/api/parts/shells:social'

/**
 * @param {string} path API 路径（含前导 `/`）
 * @returns {string} 附带 actingEntityHash 的路径
 */
function withActingQuery(path) {
	const acting = socialState.actingEntityHash
	if (!acting || acting === socialState.viewerEntityHash) return path
	const sep = path.includes('?') ? '&' : '?'
	return `${path}${sep}actingEntityHash=${encodeURIComponent(acting)}`
}

/**
 * 调用 Social shell 受保护 HTTP API 并返回 JSON。
 * @param {string} path API 路径（含前导 `/`）
 * @param {object} [options] fetch 选项
 * @returns {Promise<any>} 解析后的 JSON
 */
export async function socialApi(path, options = {}) {
	const response = await fetch(`${SOCIAL_API}${withActingQuery(path)}`, {
		credentials: 'include',
		headers: { 'Content-Type': 'application/json', ...options.headers || {} },
		...options,
	})
	if (!response.ok) throw new Error(await response.text())
	return response.json()
}

/**
 * @returns {string | null} 当前 effective acting entityHash（operator 或 agent）
 */
export function effectiveActingEntityHash() {
	return socialState.actingEntityHash || socialState.viewerEntityHash
}
