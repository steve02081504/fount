import express from 'npm:express'
import { WebSocketServer } from 'npm:ws'
const servers = {}
export function on_upgrade(request, socket, head) {
	if (servers[request.url])
		servers[request.url].handleUpgrade(request, socket, head, function done(ws) {
			servers[request.url].emit('connection', ws, request)
		})
	else socket.destroy()
}
export function WsAbleRouter() {
	const router = express.Router()

	router.ws = (path, handler) => {
		const wss = new WebSocketServer({ noServer: true })
		wss.on('connection', handler)
		servers[path] = wss
		return router
	}
	return router
}
