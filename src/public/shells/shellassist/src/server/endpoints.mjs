import { handleTerminalConnection } from './terminal_ws.mjs'

export function setEndpoints(router) {
	router.get('/ws/shells/shellassist/terminal', (req, res) => {
		res.writeHead(101, {
			'Upgrade': 'websocket',
			'Connection': 'Upgrade'
		})
		handleTerminalConnection(res)
	})
	router.ws('/ws/shells/shellassist/terminal', handleTerminalConnection)
}
