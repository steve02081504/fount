import { handleTerminalConnection } from './terminal_ws.mjs'

export function setEndpoints(router) {
	router.ws('/ws/shells/shellassist/terminal', handleTerminalConnection)
}
