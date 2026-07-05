/**
 * 【文件】src/endpoints.mjs
 * 【职责】chat shell 的 HTTP/WebSocket 路由注册中心，覆盖用户偏好、联邦设置、群会话 CRUD、附件与实时信令等对外 API。
 * 【原理】setEndpoints(router) 在 authenticate 之后挂路由：REST 读写 shellData；群联邦路由见 group/endpoints.mjs；本子模块按域装配 prefs / discovery / mailbox / sessions / WS 等。
 * 【关联】被 main.mjs Load 调用；聚合 endpoints/*、profile、stickers。
 */
import { registerDiscoveryRoutes } from './endpoints/discovery.mjs'
import { registerGroupsRuntimeRoutes } from './endpoints/groups_runtime.mjs'
import { registerMailboxRoutes } from './endpoints/mailbox.mjs'
import { registerPrefsRoutes } from './endpoints/prefs.mjs'
import { registerSessionRoutes } from './endpoints/sessions.mjs'
import { registerTrustedAuthorsRoutes } from './endpoints/trustedAuthors.mjs'
import { registerWsRoutes } from './endpoints/ws.mjs'
import { setEndpoints as registerStickerRoutesUnderChat } from './stickers/endpoints.mjs'

/**
 * 为聊天功能设置API端点。
 *
 * @param {import('npm:websocket-express').Router} router - Express路由实例，用于附加端点。
 */
export function setEndpoints(router) {
	registerStickerRoutesUnderChat(router, '/api/parts/shells:chat/stickers')

	registerPrefsRoutes(router)
	registerDiscoveryRoutes(router)
	registerMailboxRoutes(router)
	registerWsRoutes(router)
	registerGroupsRuntimeRoutes(router)
	registerSessionRoutes(router)
	registerTrustedAuthorsRoutes(router)
}
