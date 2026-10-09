import http from 'node:http'

import * as Sentry from 'npm:@sentry/node'
import express from 'npm:express'
import { WebSocketServer } from 'npm:ws'

/**
 * 为升级请求构造响应对象。
 *
 * 升级前的 socket 仍是普通 HTTP 流：认证 / 限流失败时必须写出真实状态码，
 * 写死 426 会把「未登录」伪装成「客户端 / 代理不支持 WebSocket」。
 * 实例借用 express 的响应方法（`status` / `json` / `redirect` …），
 * 与普通路由看到的 `res` 一致——含 `maskNotFound` 之类对 `res.end` / `writeHead` 的包装。
 * @param {import('node:http').IncomingMessage} req - HTTP 请求对象。
 * @param {import('node:net').Socket} socket - 客户端 socket。
 * @param {() => void} onFinished - 响应写出后的收尾回调。
 * @returns {import('npm:express').Response} 响应对象。
 */
function createUpgradeResponse(req, socket, onFinished) {
	const res = new http.ServerResponse(req)
	Object.setPrototypeOf(res, express.response)
	// express 的响应方法会读 `app` 的设置（etag / json spaces…）与 `req`：升级响应没有这些设置，一律按默认。
	res.app = {
		/** @returns {undefined} 升级响应没有 express 设置 */
		get: () => undefined,
	}
	res.req = req
	res.locals = {}
	// 拒绝后这条连接不再复用：如实声明，并在响应落地后关闭。
	// 用 destroySoon 而不是 destroy——destroy 会 RST，把刚写出的状态行一起丢掉。
	res.shouldKeepAlive = false
	res.assignSocket(socket)
	res.on('finish', () => {
		onFinished()
		socket.destroySoon()
	})
	return res
}

/**
 * 使用 WebSocket 功能增强 Express 路由器。
 * @param {import('npm:express').Router} [router=express.Router()] - 要增强的 Express 路由器。
 * @param {import('node:http').Server} [httpServer=null] - 要绑定的 HTTP 服务器。
 * @returns {import('npm:express').Router} 增强后的路由器。
 */
export function WsAbleRouter(router = express.Router(), httpServer = null) {
	/**
	 * 处理 WebSocket 升级请求。
	 * @param {import('node:http').IncomingMessage} req - HTTP 请求对象。
	 * @param {import('node:net').Socket} socket - 客户端和服务器之间的网络套接字。
	 * @param {Buffer} head - 已升级流的第一个数据包。
	 */
	router.ws_on_upgrade = async (req, socket, head) => {
		/** 升级完成、或升级阶段的响应已写出时调用：结束下面的等待。 */
		let settleUpgrade
		const upgradeSettled = new Promise(resolve => { settleUpgrade = resolve })
		const res = createUpgradeResponse(req, socket, settleUpgrade)
		Object.assign(req, {
			ws: {
				socket,
				head,
				/** 升级是否已完成：完成后只能走 WebSocket 语义，不能再写 HTTP 状态行。 */
				upgraded: false,
				/** @type {import('npm:ws').WebSocket | null} 升级完成后的连接 */
				connection: null,
				/**
				 * 拒绝本次升级。
				 * @param {number} [status=401] HTTP 状态码。
				 * @param {string} [message='Unauthorized'] 说明。
				 * @returns {void}
				 */
				fail: (status = 401, message = 'Unauthorized') => {
					if (req.ws.upgraded) {
						if (!socket.destroyed) socket.destroy()
						return
					}
					res.status(status).json({ message })
				},
				/** 标记 WebSocket 连接已成功建立。 @returns {void} */
				done: settleUpgrade,
			},
			/**
			 * 模拟 Express 的 `accepts` 方法：升级被拒一律答 JSON，不做登录页重定向。
			 * @param {any} _ - 未使用的参数。
			 * @returns {number} 总是返回 0。
			 */
			accepts: _ => 0,
			ip: req.socket.remoteAddress,
		})

		try {
			await router(req, res)
			await upgradeSettled
			// 升级被拒（认证 401 之类）是预期路径：只留一行，不打 Sentry。
			if (!req.ws.upgraded) console.warn(`WebSocket upgrade rejected: ${res.statusCode} (${req.method} ${req.url})`)
		}
		catch (error) {
			// 升级阶段还能写 HTTP：按错误自带的状态码答一次；已答过或已完成握手都不补写。
			if (!req.ws.upgraded && !res.headersSent)
				res.status(error?.http_code ?? 500).json({ message: error?.message })
			if (error?.http_code) console.warn(`WebSocket upgrade rejected: ${error.http_code} (${req.method} ${req.url})`)
			else if (!error?.skip_report) {
				console.error('WebSocket upgrade error:', error)
				Sentry.captureException(error)
			}
			// 握手已完成：HTTP 状态行早已发出，只能用 WebSocket 关闭帧收尾。
			if (req.ws.upgraded && req.ws.connection)
				try { req.ws.connection.close(1011, 'Internal error') } catch { socket.destroy() }
		}
	}
	/**
	 * 为给定的路径注册一个 WebSocket 处理器。
	 * @param {string} path - 路由路径。
	 * @param {...any} handlers - 中间件和 WebSocket 连接处理器。
	 * @returns {import('npm:express').Router} 增强后的路由器。
	 */
	router.ws = (path, ...handlers) => {
		const wss = new WebSocketServer({
			noServer: true,
			perMessageDeflate: true,
			/**
			 * 处理 WebSocket 协议。
			 * @param {Set<string>} protocols - 客户端支持的协议集。
			 * @returns {string|boolean} 选择的协议或 false。
			 */
			handleProtocols: (protocols) => {
				if (protocols.size) return protocols.values().next().value
				return false
			}
		})
		const handler = handlers.pop()
		wss.on('connection', (ws, req) => {
			// 升级已完成：处理器抛错只能按 WebSocket 语义收尾（关闭帧 + 上报），
			// 不能让异常变成 unhandled rejection 把连接吊在半开状态。
			Promise.resolve().then(() => handler(ws, req)).catch(error => {
				if (!error?.skip_report) {
					console.error('WebSocket connection handler error:', error)
					Sentry.captureException(error)
				}
				else console.warn(`WebSocket connection handler rejected: ${error?.http_code ?? ''} ${error?.message ?? error}`)
				try { ws.close(1011, 'Internal error') } catch { /* already closed */ }
			})
		})
		wss.on('wsClientError', (error, socket, req) => {
			console.error('WebSocket client error:', error)
			req.ws?.fail?.(400, error.message)
		})
		router.get(path, ...handlers, (req, res) => {
			if (!req.ws) return res.status(400).json({ message: 'This is a WebSocket-only endpoint.' })
			const { socket, head } = req.ws
			wss.handleUpgrade(req, socket, head, ws => {
				req.ws.upgraded = true
				req.ws.connection = ws
				wss.emit('connection', ws, req)
				req.ws?.done?.()
			})
		})
		return router
	}
	/**
	 * 将 WebSocket 升级处理器绑定到一个 HTTP 服务器。
	 * @param {import('node:http').Server} server - 要绑定的 HTTP 服务器。
	 * @returns {import('npm:express').Router} 增强后的路由器。
	 */
	router.ws_bindServer = server => {
		server.on('upgrade', router.ws_on_upgrade)
		return router
	}
	if (httpServer) router.ws_bindServer(httpServer)
	return router
}
/**
 * 使用 WebSocket 功能增强 Express 应用程序。
 * @param {import('npm:express').Application} [app=express()] - 要增强的 Express 应用程序。
 * @param {import('node:http').Server} [httpServer=null] - 要绑定的 HTTP 服务器。
 * @returns {import('npm:express').Application} 增强后的应用程序。
 */
export function WsAbleApp(app = express(), httpServer = null) {
	return WsAbleRouter(app, httpServer)
}
