/**
 * 【文件】social/src/endpoints.mjs
 * 【职责】Social shell HTTP/WS 路由聚合入口。
 */
import { registerDiscoverRoutes } from './endpoints/routes/discover.mjs'
import { registerFeedRoutes } from './endpoints/routes/feed.mjs'
import { registerPostsRoutes } from './endpoints/routes/posts.mjs'
import { registerProfileRoutes } from './endpoints/routes/profile.mjs'
import { registerRelationshipsRoutes } from './endpoints/routes/relationships.mjs'
import { registerSavedRoutes } from './endpoints/routes/saved.mjs'
import { registerVaultRoutes } from './endpoints/routes/vault.mjs'

/**
 * 注册 Social shell 全部 HTTP/WS 路由。
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @returns {void}
 */
export function setEndpoints(router) {
	registerFeedRoutes(router)
	registerDiscoverRoutes(router)
	registerProfileRoutes(router)
	registerPostsRoutes(router)
	registerRelationshipsRoutes(router)
	registerSavedRoutes(router)
	registerVaultRoutes(router)
}
