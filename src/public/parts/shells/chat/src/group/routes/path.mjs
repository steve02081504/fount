/** Chat 群 REST API 路径前缀（shell 路由注册共用）。 */
export const GROUP_API_PREFIX = '/api/parts/shells:chat/groups'

/**
 * @param {string} [tail] 群 ID 之后的相对路径（可含命名分组）
 * @returns {RegExp} Express 路由正则（捕获 groupId 为 params[0]）
 */
export function groupRouteRegex(tail = '') {
	const escaped = GROUP_API_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const suffix = tail ? `/${String(tail).replace(/^\//u, '')}` : ''
	return new RegExp(`^${escaped}/([^/]+)${suffix}`, 'iu')
}

/**
 * @param {string} groupId 群 ID
 * @param {string} [tail] 后缀路径
 * @returns {string} 字面量 API 路径
 */
export function groupApiPath(groupId, tail = '') {
	const suffix = tail ? `/${String(tail).replace(/^\//u, '')}` : ''
	return `${GROUP_API_PREFIX}/${encodeURIComponent(groupId)}${suffix}`
}
