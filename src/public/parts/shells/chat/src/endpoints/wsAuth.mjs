import { getUserByReq } from '../../../../../../server/auth/index.mjs'

/**
 * 用显式关闭码/原因关闭 WebSocket；已进入 CLOSING/CLOSED 时直接终止。
 * @param {import('npm:ws').WebSocket} ws WebSocket
 * @param {number} code 关闭码（4xxx 应用级）
 * @param {string} reason 关闭原因
 * @returns {void}
 */
export function closeWebSocket(ws, code, reason) {
	try {
		if (ws.readyState === 1) ws.close(code, reason)
		else if (ws.readyState !== 3) ws.terminate()
	}
	catch { /* 连接已不可关闭 */ }
}

/**
 * WebSocket：鉴权失败或 handler 抛错时以显式关闭码关闭连接，并记录异常。
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
		catch (error) {
			const unauthorized = error?.http_code === 401
			if (!unauthorized)
				console.error('[chat ws] authenticated handler failed', error)
			closeWebSocket(ws, unauthorized ? 4401 : 1011, unauthorized ? 'unauthorized' : 'internal error')
		}
	})()
}
