/** Chat shell REST API 前缀（浏览器 fetch，无 Express 转义）。 */
export const CHAT_API_CLIENT_PREFIX = '/api/parts/shells:chat'

/** 群集合 REST 前缀（浏览器 fetch）。 */
export const GROUPS_CLIENT_PREFIX = `${CHAT_API_CLIENT_PREFIX}/groups`

/**
 * @param {string} groupId 群 ID
 * @param {...string} tail 后缀路径段
 * @returns {string} 客户端 fetch 路径
 */
export function groupApiPath(groupId, ...tail) {
	const segments = tail.flat().filter(Boolean).map(part => String(part).replace(/^\//u, ''))
	const suffix = segments.length ? `/${segments.join('/')}` : ''
	return `${GROUPS_CLIENT_PREFIX}/${encodeURIComponent(groupId)}${suffix}`
}
