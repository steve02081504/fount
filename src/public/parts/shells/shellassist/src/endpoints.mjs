import { handleTerminalConnection } from './terminal_ws.mjs'

/**
 * 为终端辅助功能设置API端点。
 * @param {object} router - Express的路由实例。
 */
export function setEndpoints(router) {
	router.ws('/ws/parts/shells:shellassist/terminal', handleTerminalConnection)
}
