import { setEndpoints } from './endpoints.mjs'
import { setGroupEndpoints } from './group/endpoints.mjs'

/**
 * Chat shell 全部 HTTP/WS 路由单入口：群域 + 非群域（entity / stickers / prefs / …）。
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @returns {void}
 */
export function registerChatRoutes(router) {
	setGroupEndpoints(router)
	setEndpoints(router)
}
