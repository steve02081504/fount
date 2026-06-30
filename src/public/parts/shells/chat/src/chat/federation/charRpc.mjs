/**
 * 【文件】federation/charRpc.mjs
 * 【职责】解析与构造 Trystero char_rpc / char_rpc_response 线格式，统一 RPC 错误码并安全发送响应。
 * 【原理】room 收到 char_rpc 后本地 tryInvokeLocalChar/WorldRpc，结果经 encodeWireJson 边界校验再 safeSendCharRpcResponse；远端响应由 groupWsHub.relayOrConsumeRpcResponse 接回群 WebSocket 等待方。与群 WS rpc_call 形成「浏览器 WS ↔ 本机 ↔ P2P ↔ 远端节点」链路。
 * 【数据结构】请求 { requestId, memberId, method, args[] }；响应 rpc_end | rpc_error + code。
 * 【关联】room.mjs、session.mjs、stream/groupWsHub.mjs、lib/jsonBoundary.mjs、remoteProxy.mjs。
 */
import { isPlainObject } from '../../../../../../../scripts/p2p/wire_ingress.mjs'

/**
 * 统一映射 RPC 错误码。
 * @param {unknown} code 原始错误码
 * @returns {string} 对外稳定错误码
 */
export function normalizeFederationRpcErrorCode(code) {
	if (code === 'RPC_INVALID_ARGUMENT') return 'RPC_INVALID_ARGUMENT'
	if (code === 'RPC_INVALID_RESULT') return 'RPC_INVALID_RESULT'
	if (code === 'JSON_SERIALIZATION_ERROR') return 'JSON_SERIALIZATION_ERROR'
	if (code === 'METHOD_NOT_FOUND') return 'METHOD_NOT_FOUND'
	if (code === 'REMOTE_UNAVAILABLE') return 'REMOTE_UNAVAILABLE'
	return 'EXECUTION_ERROR'
}

/**
 * 解析 `char_rpc` 入站请求。
 * @param {unknown} data Trystero 载荷
 * @returns {{ requestId: string, memberId: string, method: string, args: unknown[] } | null} 合法请求或 null
 */
export function parseCharRpcRequest(data) {
	if (!isPlainObject(data)) return null
	const { requestId, memberId, method, args } = data
	if (!requestId || !memberId || !method) return null
	return {
		requestId: String(requestId),
		memberId: String(memberId),
		method: String(method),
		args: Array.isArray(args) ? args : [],
	}
}

/**
 * @param {string} requestId 请求 ID
 * @param {string} error 错误信息
 * @param {unknown} code 原始错误码
 * @returns {{ type: 'rpc_error', requestId: string, error: string, code: string }} 标准化 rpc_error
 */
export function buildRpcErrorResponse(requestId, error, code) {
	return {
		type: 'rpc_error',
		requestId,
		error,
		code: normalizeFederationRpcErrorCode(code),
	}
}

/**
 * @param {(payload: unknown, peerId: string | null) => void} sendCharRpcResponse char_rpc_response 发送函数
 * @param {unknown} response 待发送响应
 * @param {string | null} peerId 目标 peer
 * @returns {void}
 */
export function safeSendCharRpcResponse(sendCharRpcResponse, response, peerId) {
	try { sendCharRpcResponse(response, peerId) }
	catch (error) { console.error('federation: char_rpc_response failed', error) }
}
