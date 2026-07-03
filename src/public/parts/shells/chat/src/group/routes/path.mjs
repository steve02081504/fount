/** Chat shell REST API 前缀（Express 字面量路由：`shells\:chat`）。 */
export const CHAT_API_PREFIX = '/api/parts/shells\\:chat'

export {
	CHAT_API_CLIENT_PREFIX,
	GROUPS_CLIENT_PREFIX,
	groupApiPath,
} from '../../../public/shared/apiPaths.mjs'

/** 群集合 REST 前缀（Express 路由注册）。 */
export const GROUPS_PREFIX = `${CHAT_API_PREFIX}/groups`

/** 64 位 hex 事件 ID 路径参数（格式校验在 handler 内完成）。 */
export const EVENT_ID_PARAM = ':eventId'
