/**
 * 【文件】social/src/endpoints.mjs
 * 【职责】Social shell HTTP/WS 路由聚合入口。
 * 【原理】按域装配 feed / discover / profile / posts / relationships / saved / vault 子模块。
 */
import { registerDiscoverRoutes } from './endpoints/discover/index.mjs'
import { registerFeedRoutes } from './endpoints/feed/index.mjs'
import { registerPostsRoutes } from './endpoints/posts/index.mjs'
import { registerProfileRoutes } from './endpoints/profile/index.mjs'
import { registerRelationshipsRoutes } from './endpoints/relationships/index.mjs'
import { registerSavedRoutes } from './endpoints/saved/index.mjs'
import { registerVaultRoutes } from './endpoints/vault/index.mjs'

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
