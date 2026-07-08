/**
 * 【文件】social/src/endpoints.mjs
 * 【职责】Social shell HTTP/WS 路由聚合入口。
 */
import { registerDiscoverRoutes } from './endpoints/discover.mjs'
import { registerFeedRoutes } from './endpoints/feed.mjs'
import { registerNotificationRoutes } from './endpoints/notifications.mjs'
import { registerPostsRoutes } from './endpoints/posts.mjs'
import { registerProfileRoutes } from './endpoints/profile.mjs'
import { registerRelationshipsRoutes } from './endpoints/relationships.mjs'
import { registerSavedRoutes } from './endpoints/saved.mjs'
import { registerSearchRoutes } from './endpoints/search.mjs'
import { registerTranslateRoutes } from './endpoints/translate.mjs'
import { registerVaultRoutes } from './endpoints/vault.mjs'
import { registerViewerRoutes } from './endpoints/viewer.mjs'

/**
 * 注册 Social shell 全部 HTTP/WS 路由。
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @returns {void}
 */
export function setEndpoints(router) {
	registerFeedRoutes(router)
	registerDiscoverRoutes(router)
	registerSearchRoutes(router)
	registerNotificationRoutes(router)
	registerTranslateRoutes(router)
	registerViewerRoutes(router)
	registerProfileRoutes(router)
	registerPostsRoutes(router)
	registerRelationshipsRoutes(router)
	registerSavedRoutes(router)
	registerVaultRoutes(router)
}
