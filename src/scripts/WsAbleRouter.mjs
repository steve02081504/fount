import express from 'npm:express'
import { WebSocketServer } from 'npm:ws'

export function WsAbleRouter(router = express.Router(), httpServer = null) {
	router.ws_on_upgrade = async (req, socket, head) => {
		let resolve, reject
		Object.assign(req, {
			ws: {
				socket,
				head,
				fail: () => {
					if (!socket.destroyed) {
						socket.write('HTTP/1.1 426 Upgrade Required\r\n\r\n')
						socket.destroy()
					}
					reject(new Error('WebSocket connection rejected'))
				},
				done: () => resolve(),
			},
			accepts: _ => 0,
			ip: req.socket.remoteAddress,
		})

		const res = {
			setHeader: () => { },
			getHeader: () => undefined,
			removeHeader: () => { },
			end: () => req.ws.fail(),
		}

		try {
			await new Promise((my_resolve, my_reject) => {
				resolve = my_resolve; reject = my_reject
				return (async () => await router(req, res))().catch(reject)
			})
		}
		catch (e) {
			console.error('WebSocket upgrade error:', e)
			if (!socket.destroyed) socket.destroy()
		}
	}
	router.ws = (path, ...handlers) => {
		const wss = new WebSocketServer({
			noServer: true,
			perMessageDeflate: true,
			handleProtocols: (protocols) => {
				if (protocols.size > 0) return protocols.values().next().value
				return false
			}
		})
		const handler = handlers.pop()
		wss.on('connection', handler)
		wss.on('wsClientError', (error, socket, req) => {
			console.error('WebSocket client error:', error)
			req.ws?.fail?.()
		})
		router.get(path, ...handlers, (req, res) => {
			if (!req.ws) return res.status(400).json({ message: 'This is a WebSocket-only endpoint.' })
			const { socket, head } = req.ws
			wss.handleUpgrade(req, socket, head, ws => {
				wss.emit('connection', ws, req)
				req.ws?.done?.()
			})
		})
		return router
	}
	router.ws_bindServer = server => {
		server.on('upgrade', router.ws_on_upgrade)
		return router
	}
	if (httpServer) router.ws_bindServer(httpServer)
	return router
}
export function WsAbleApp(app = express(), httpServer = null) {
	return WsAbleRouter(app, httpServer)
}
