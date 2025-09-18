import http from 'node:http'

import express from 'npm:express'
import { WebSocketServer } from 'npm:ws'

export function WsAbleRouter(router = express.Router(), httpServer = null) {
	router.ws_on_upgrade = async (req, socket, head) => {
		Object.assign(req, {
			ws: {
				socket,
				head,
				isHandled: false
			},
			accepts: _ => 0,
			ip: req.socket.remoteAddress,
		})

		const res = new http.ServerResponse(req)
		Object.assign(res, {
			end: _ => socket.end(),
		})

		try {
			await router(req, res)

			if (!req.ws.isHandled) {
				socket.write('HTTP/1.1 426 Upgrade Required\r\n\r\n')
				socket.destroy()
			}
		} catch (e) {
			if (!socket.destroyed) socket.destroy()
		}
	}
	router.ws = (path, ...handlers) => {
		const wss = new WebSocketServer({ noServer: true })
		const handler = handlers.pop()
		wss.on('connection', handler)
		router.get(path, ...handlers, (req, res) => {
			if (!req.ws) return res.status(400).json({ message: 'This is a WebSocket-only endpoint.' })
			req.ws.isHandled = true
			const { socket, head } = req.ws
			wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
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
