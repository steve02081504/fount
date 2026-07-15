/**
 * 【文件】src/endpoints.mjs
 * 【职责】chat shell 的 HTTP/WebSocket 路由注册中心，覆盖用户偏好、联邦设置、群会话 CRUD、附件与实时信令等对外 API。
 * 【原理】setEndpoints(router) 在 authenticate 之后挂路由：REST 读写 shellData；群联邦路由见 group/endpoints.mjs；本子模块按域装配 prefs / discovery / mailbox / sessions / WS 等。
 * 【关联】被 main.mjs Load 调用；聚合 endpoints/*、profile、stickers。
 */
import { authenticate } from '../../../../../server/auth/index.mjs'

import { registerBridgeRoutes } from './endpoints/bridge.mjs'
import { registerDiscoveryRoutes } from './endpoints/discovery.mjs'
import { registerGlobalSearchRoutes } from './endpoints/globalSearch.mjs'
import { registerGroupsRuntimeRoutes } from './endpoints/groups/runtime.mjs'
import { registerInboxRoutes } from './endpoints/inbox.mjs'
import { registerMailboxRoutes } from './endpoints/mailbox.mjs'
import { registerPrefsRoutes } from './endpoints/preferences.mjs'
import { registerSessionRoutes } from './endpoints/sessions.mjs'
import { registerTestSeedRoutes } from './endpoints/testSeed.mjs'
import { registerTranslateRoutes } from './endpoints/translate.mjs'
import { registerTranslationPrefsRoutes } from './endpoints/translationPrefs.mjs'
import { registerTrustedAuthorsRoutes } from './endpoints/trustedAuthors.mjs'
import { registerWsRoutes } from './endpoints/ws.mjs'
import { registerEntityEndpoints } from './entity/endpoints.mjs'
import { setEndpoints as registerStickerRoutesUnderChat } from './stickers/endpoints.mjs'

/**
 * 为聊天功能设置API端点。
 *
 * @param {import('npm:websocket-express').Router} router - Express路由实例，用于附加端点。
 */
export function setEndpoints(router) {
	registerEntityEndpoints(router)
	registerStickerRoutesUnderChat(router, '/api/parts/shells:chat/stickers')

	registerPrefsRoutes(router)
	registerTranslateRoutes(router)
	registerTranslationPrefsRoutes(router)
	registerBridgeRoutes(router)
	registerDiscoveryRoutes(router)
	registerGlobalSearchRoutes(router)
	registerMailboxRoutes(router)
	registerInboxRoutes(router)
	registerWsRoutes(router)
	registerGroupsRuntimeRoutes(router)
	registerSessionRoutes(router)
	registerTrustedAuthorsRoutes(router)
	if (process.env.FOUNT_TEST === '1' || process.env.FOUNT_TEST_ISOLATED === '1')
		registerTestSeedRoutes(router, authenticate)
}
