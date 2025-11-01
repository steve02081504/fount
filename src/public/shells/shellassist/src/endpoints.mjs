import { handleTerminalConnection } from './terminal_ws.mjs'

/**
 * @file shellassist/src/endpoints.mjs
 * @description shellassist 的端点。
 * @namespace shellassist.endpoints
 */

/**
 * @function setEndpoints
 * @description 设置端点。
 * @memberof shellassist.endpoints
 * @param {object} router - 路由。
 */
export function setEndpoints(router) {
	router.ws('/ws/shells/shellassist/terminal', handleTerminalConnection)
}
