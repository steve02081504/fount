/**
 * IDE 集成 Shell：仅注册 ACP WebSocket 服务（客户端通过 fount_ide_agent.mjs stdio 连接）。
 */
import { authenticate } from '../../../../../server/auth.mjs'

import { handleAcpWs } from './acp_ws.mjs'

const WS_ACP = '/ws/parts/shells\\:ideIntegration/acp'

/**
 * 设置 WebSocket 端点。
 * @param {object} router - Express 路由器。
 */
export function setEndpoints(router) {
	/**
	 * ACP WebSocket 端点。
	 * @param {object} ws - WebSocket 对象。
	 * @param {object} req - Express 请求对象。
	 */
	router.ws(WS_ACP, authenticate, async (ws, req) => {
		try {
			await handleAcpWs(ws, req)
		} catch (error) {
			ws.close(4500, error.message || 'ACP setup failed')
		}
	})
}
