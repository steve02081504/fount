/**
 * 【文件】group/routes/auditLog.mjs
 * 【职责】群审计日志只读 HTTP，供管理员按类型与时间分页查询治理事件。
 * 【原理】成员校验后要求治理频道 ADMIN；查询参数 types/before/offset/limit 传给 listAuditLogEntries。
 * 【数据结构】audit log entries、hasMore、total、AUDIT_LOG_EVENT_TYPES 过滤集。
 * 【关联】被 group/endpoints.mjs 注册；依赖 chat/auditLog.mjs、access.mjs。
 */
import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { PERMISSIONS } from 'fount/public/parts/shells/chat/src/permissions/chat.mjs'
import { AUDIT_LOG_EVENT_TYPES, listAuditLogEntries } from '../../chat/auditLog.mjs'
import { canInChannel, governanceChannelId } from '../access.mjs'

import { requireGroupMember } from './middleware.mjs'
import { GROUPS_PREFIX } from './path.mjs'

/**
 * 注册群审计日志路由（仅管理员可读）。
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权中间件
 * @returns {void}
 */
export function registerAuditLogRoutes(router, authenticate) {
	router.get(`${GROUPS_PREFIX}/:groupId/audit-log`, authenticate, requireGroupMember(), async (req, res) => {
		const { username, groupId, state, member } = req.groupContext
		if (!canInChannel(state, member, PERMISSIONS.ADMIN, governanceChannelId(state)))
			throw httpError(403, 'ADMIN required')

		const typesRaw = String(req.query.types || '').trim()
		const types = typesRaw ? typesRaw.split(',').map(t => t.trim()).filter(Boolean) : undefined
		if (types?.some(t => !AUDIT_LOG_EVENT_TYPES.has(t)))
			throw httpError(400, 'invalid audit log type filter')

		const hasOffset = req.query.offset !== undefined && req.query.offset !== ''
		const { entries, hasMore, total } = await listAuditLogEntries(username, groupId, {
			before: hasOffset ? undefined : req.query.before ? String(req.query.before) : undefined,
			offset: hasOffset ? Number(req.query.offset) : undefined,
			limit: req.query.limit !== undefined ? Number(req.query.limit) : undefined,
			types,
		})
		res.status(200).json({
			entries,
			hasMore,
			total: total ?? entries.length,
			types: [...AUDIT_LOG_EVENT_TYPES].sort(),
		})
	})
}
