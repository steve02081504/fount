/** Chat shell REST API 前缀（浏览器 fetch，无 Express 转义）。 */
export const CHAT_API_CLIENT_PREFIX = '/api/parts/shells:chat'

/** 群集合 REST 前缀（浏览器 fetch）。 */
export const GROUPS_CLIENT_PREFIX = `${CHAT_API_CLIENT_PREFIX}/groups`
