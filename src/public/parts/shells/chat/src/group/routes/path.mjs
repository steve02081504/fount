/** Chat shell REST API 前缀（Express 字面量路由：`shells\:chat`）。 */
export const CHAT_API_PREFIX = '/api/parts/shells\\:chat'

/** 浏览器 fetch 用 Chat API 前缀（无 Express 转义）。 */
export const CHAT_API_CLIENT_PREFIX = '/api/parts/shells:chat'

/** 群集合 REST 前缀（Express 路由注册）。 */
export const GROUPS_PREFIX = `${CHAT_API_PREFIX}/groups`

/** 群集合 REST 前缀（浏览器 fetch）。 */
export const GROUPS_CLIENT_PREFIX = `${CHAT_API_CLIENT_PREFIX}/groups`

/** 64 位 hex 事件 ID 路径参数（格式校验在 handler 内完成）。 */
export const EVENT_ID_PARAM = ':eventId'

/**
 * @param {string} groupId 群 ID
 * @param {...string} tail 后缀路径段
 * @returns {string} 字面量 API 路径（用于客户端 fetch）
 */
export function groupApiPath(groupId, ...tail) {
	const segments = tail.flat().filter(Boolean).map(part => String(part).replace(/^\//u, ''))
	const suffix = segments.length ? `/${segments.join('/')}` : ''
	return `${GROUPS_CLIENT_PREFIX}/${encodeURIComponent(groupId)}${suffix}`
}
