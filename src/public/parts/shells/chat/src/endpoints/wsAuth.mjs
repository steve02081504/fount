import { getUserByReq } from '../../../../../../server/auth/index.mjs'

/**
 * WebSocket：鉴权失败或 handler 抛错时关闭连接。
 * @param {import('npm:ws').WebSocket} ws WebSocket
 * @param {import('npm:express').Request} req 已挂 authenticate 的请求
 * @param {(user: object) => void | Promise<void>} handler 业务逻辑
 * @returns {void}
 */
export function runAuthenticatedWs(ws, req, handler) {
	void (async () => {
		try {
			const user = getUserByReq(req)
			await handler(user)
		}
		catch {
			ws.close()
		}
	})()
}
