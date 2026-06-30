/**
 * 【文件】group/endpoints.mjs
 * 【职责】群子系统 HTTP 路由聚合入口，装配联邦 DAG 群组相关的全部 REST 端点。
 * 【原理】setGroupEndpoints(router) 依次调用 routes 下各 register*Routes，统一注入 authenticate；本文件不含业务逻辑，仅做模块装配。
 * 【数据结构】Express Router、authenticate RequestHandler。
 * 【关联】被 chat/src/endpoints.mjs 调用；依赖 group/routes/* 与 server/auth.mjs。
 */
import { authenticate } from '../../../../../../server/auth.mjs'

import { registerAuditLogRoutes } from './routes/auditLog.mjs'
import { registerChannelRoutes } from './routes/channels.mjs'
import { registerDagRoutes } from './routes/dag.mjs'
import { registerGovernanceRoutes } from './routes/governance.mjs'
import { registerGroupEmojiRoutes } from './routes/groupEmojis.mjs'
import { registerGroupLifecycleRoutes } from './routes/groups.mjs'
import { registerGroupSyncRoutes } from './routes/groupSync.mjs'
import { registerMembershipRoutes } from './routes/membership.mjs'

/**
 * 注册群相关 HTTP 路由（联邦 DAG 单路径）。
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @returns {void}
 */
export function setGroupEndpoints(router) {
	registerGroupLifecycleRoutes(router, authenticate)
	registerGroupSyncRoutes(router, authenticate)
	registerMembershipRoutes(router, authenticate)
	registerDagRoutes(router, authenticate)
	registerChannelRoutes(router, authenticate)
	registerGovernanceRoutes(router, authenticate)
	registerGroupEmojiRoutes(router, authenticate)
	registerAuditLogRoutes(router, authenticate)
}
