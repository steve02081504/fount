import { handleTerminalConnection } from './terminal_ws.mjs'

/**
 * shellassist 的端点。
 */

/**
 * 设置端点。
 * @param {object} router - 路由。
 */
export function setEndpoints(router) {
	router.ws('/ws/shells/shellassist/terminal', handleTerminalConnection)
}
