/**
 * 【文件】social/src/endpoints.mjs
 * 【职责】Social shell HTTP/WS 路由聚合入口。
 * 【原理】按域装配 feed / discover / profile / saved / vault 子模块。
 */
import { registerDiscoverRoutes } from './endpoints/discover_routes.mjs'
import { registerFeedRoutes } from './endpoints/feed_routes.mjs'
import { registerProfileRoutes } from './endpoints/profile_routes.mjs'
import { registerSavedRoutes } from './endpoints/saved_routes.mjs'
import { registerVaultRoutes } from './endpoints/vault_routes.mjs'

/**
 * 注册 Social shell 全部 HTTP/WS 路由。
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @returns {void}
 */
export function setEndpoints(router) {
	registerFeedRoutes(router)
	registerDiscoverRoutes(router)
	registerProfileRoutes(router)
	registerSavedRoutes(router)
	registerVaultRoutes(router)
}
