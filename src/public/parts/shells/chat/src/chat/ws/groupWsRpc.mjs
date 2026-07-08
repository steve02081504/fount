/**
 * 【文件】ws/groupWsRpc.mjs
 * 【职责】群 WebSocket RPC 中继：浏览器 rpc_call 本地执行或带 targetNodeId 转发；进程内等待 rpc_end/rpc_error；接联邦 char_rpc_response。
 * 【原理】handleGroupSocketRpcMessage 解析请求后 tryInvokeLocalChar/World 或写入 rpcRelayAwaiting 超时表；relayOrConsumeRpcResponse 匹配 requestId 唤醒等待或继续 WS 转发。identity 消息登记 clientNodeId 供定向 RPC 验收。
 * 【数据结构】rpcRelayAwaiting、serverProcessRpcWaiters Map；消息 { type, requestId, memberId, method, args, targetNodeId? }。
 * 【关联】remoteProxy.mjs、session.mjs、groupWsRooms.mjs、room char_rpc、federation/charRpc.mjs。
 */
import {
	GROUP_RPC_TARGET_NODE_ID_KEY,
	isValidGroupRpcClientNodeId,
} from '../federation/remoteProxy.mjs'
import { normalizeJsonBoundaryValue } from '../lib/jsonBoundary.mjs'
import { tryInvokeLocalCharRpc, tryInvokeLocalWorldRpc } from '../session.mjs'

import { groupSockets, rpcClientIdentities } from './groupWsRooms.mjs'

const RPC_RELAY_TIMEOUT_MS = 30_000

/**
 * @param {import('npm:websocket-express').WebSocket} ws 目标连接
 * @param {object} payload JSON 可序列化对象
 * @returns {boolean} 发送成功为 true
 */
function sendJson(ws, payload) {
	try {
		ws.send(JSON.stringify(payload))
		return true
	}
	catch (error) {
		console.error('ws send failed', error)
		return false
	}
}

/**
 * @param {import('npm:websocket-express').WebSocket} ws 目标连接
 * @param {string} requestId RPC 请求 id
 * @param {string} error 错误文案
 * @param {string} code 错误码
 * @returns {boolean} 发送成功为 true
 */
function sendRpcError(ws, requestId, error, code) {
	return sendJson(ws, { type: 'rpc_error', requestId, error, code })
}

/** @type {Map<string, { awaiterWs: import('npm:websocket-express').WebSocket, timer: ReturnType<typeof setTimeout> }>} */
const rpcRelayAwaiting = new Map()

/** @type {Map<string, { outerResolve: (v: unknown) => void, outerReject: (e: Error) => void, timer: ReturnType<typeof setTimeout> }>} */
const serverProcessRpcWaiters = new Map()

/**
 * @param {string} requestId 请求 ID
 * @param {ReturnType<typeof setTimeout>} timer 超时句柄
 * @param {unknown} value 结果
 * @param {(v: unknown) => void} outerResolve 外层 Promise resolve
 * @returns {void}
 */
function finishServerRpcSuccess(requestId, timer, value, outerResolve) {
	clearTimeout(timer)
	serverProcessRpcWaiters.delete(requestId)
	outerResolve(value)
}

/**
 * @param {string} requestId 请求 ID
 * @param {ReturnType<typeof setTimeout>} timer 超时句柄
 * @param {Error} err 错误
 * @param {(e: Error) => void} outerReject 外层 Promise reject
 * @returns {void}
 */
function finishServerRpcError(requestId, timer, err, outerReject) {
	clearTimeout(timer)
	serverProcessRpcWaiters.delete(requestId)
	outerReject(err)
}

/**
 * 服务端进程内等待 RPC 响应（联邦 char_rpc_response / 群 WS relay）。
 * @param {string} requestId 请求 ID
 * @param {number} [timeoutMs] 超时毫秒
 * @returns {Promise<unknown>} RPC 结果载荷
 */
export function awaitServerRpcResponse(requestId, timeoutMs = 30_000) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			serverProcessRpcWaiters.delete(requestId)
			reject(Object.assign(new Error('RPC timeout'), { code: 'TIMEOUT' }))
		}, timeoutMs)
		serverProcessRpcWaiters.set(requestId, { outerResolve: resolve, outerReject: reject, timer })
	})
}

/**
 * 登记群 WebSocket 的 RPC 定向身份（由客户端首包 `group_ws_rpc_identity` 上报）。
 * @param {import('npm:websocket-express').WebSocket} ws 当前连接
 * @param {string} clientNodeId UUID v4 串（与 `rpc_call.targetNodeId` 对齐）
 * @returns {void}
 */
export function registerRpcClientIdentity(ws, clientNodeId) {
	if (!isValidGroupRpcClientNodeId(clientNodeId)) return
	rpcClientIdentities.set(ws, clientNodeId.trim().toLowerCase())
}

/**
 * 处理 `group_ws_rpc_identity` 控制帧（应在 `handleGroupSocketRpcMessage` 之前调用）。
 * @param {import('npm:websocket-express').WebSocket} ws 当前连接
 * @param {object} wireMessage 已解析 JSON
 * @returns {boolean} true 表示已消费该帧
 */
export function handleGroupSocketIdentityMessage(ws, wireMessage) {
	if (wireMessage?.type !== 'group_ws_rpc_identity') return false
	registerRpcClientIdentity(ws, wireMessage.clientNodeId)
	return true
}

/**
 * 将 rpc_end / rpc_error / rpc_chunk 转发给仍在等待 relay 的发起连接。
 * @param {object} message 已解析 JSON
 * @returns {boolean} 已消费（属于 relay 或不应再走其它逻辑）
 */
export function relayOrConsumeRpcResponse(message) {
	const type = message?.type
	if (!['rpc_end', 'rpc_error', 'rpc_chunk'].includes(type)) return false
	const {requestId} = message
	if (!requestId) return false

	const serverWait = serverProcessRpcWaiters.get(requestId)
	if (serverWait) {
		if (type === 'rpc_error') {
			const err = new Error(message.error || 'RPC error')
			err.code = message.code || 'EXECUTION_ERROR'
			finishServerRpcError(requestId, serverWait.timer, err, serverWait.outerReject)
		}
		else if (type === 'rpc_chunk')
			return true
		else
			finishServerRpcSuccess(requestId, serverWait.timer, message.result, serverWait.outerResolve)

		return true
	}

	const pending = rpcRelayAwaiting.get(requestId)
	if (!pending) return false

	sendJson(pending.awaiterWs, message)

	if (type === 'rpc_chunk') return true

	clearTimeout(pending.timer)
	rpcRelayAwaiting.delete(requestId)
	return true
}

/**
 * 处理客户端经群 WS 发来的 RPC 控制帧（应在其它业务 switch 之前调用）。
 * @param {string} groupId 纯群组 id（本地 char/world runtime 查找键）
 * @param {string} roomKey 群 WS 房间键（`ownerNodeHash:groupId`，多连接转发查找键）
 * @param {import('npm:websocket-express').WebSocket} ws 当前连接
 * @param {object} wireMessage 已解析 JSON
 * @returns {boolean} true 表示已处理，调用方应跳过后续 switch
 */
export function handleGroupSocketRpcMessage(groupId, roomKey, ws, wireMessage) {
	if (['rpc_end', 'rpc_error', 'rpc_chunk'].includes(wireMessage?.type))
		return relayOrConsumeRpcResponse(wireMessage)

	if (wireMessage?.type !== 'rpc_call') return false

	const { requestId, memberId, method } = wireMessage
	if (!requestId || !memberId || !method) return true

	void handleRpcCall(ws, groupId, roomKey, wireMessage)
	return true
}

/**
 * @param {import('npm:websocket-express').WebSocket} senderWs 发起方
 * @param {string} groupId 纯群组 id（本地 char/world runtime 查找键）
 * @param {string} roomKey 群 WS 房间键（多连接转发查找键）
 * @param {object} wireMessage 原始 `rpc_call` 消息（保留 `targetNodeId` 等扩展字段）
 * @returns {Promise<void>}
 */
async function handleRpcCall(senderWs, groupId, roomKey, wireMessage) {
	const { requestId, memberId, method, args = [], ttl = 3 } = wireMessage
	let list
	try {
		list = normalizeJsonBoundaryValue(Array.isArray(args) ? args : [], `groupWsRpc.args:${method}`)
	}
	catch (error) {
		const code = error?.code === 'RPC_INVALID_ARGUMENT' ? 'RPC_INVALID_ARGUMENT' : 'JSON_SERIALIZATION_ERROR'
		return void sendRpcError(senderWs, requestId, String(error?.message || error), code)
	}
	try {
		const local = String(memberId || '').includes(':world:')
			? await tryInvokeLocalWorldRpc(groupId, memberId, method, list)
			: await tryInvokeLocalCharRpc(groupId, memberId, method, list)
		if (local.kind === 'result')
			return void sendJson(senderWs, { type: 'rpc_end', requestId, result: local.value })
		if (local.kind === 'method_not_found')
			return void sendRpcError(senderWs, requestId, 'method not found', 'METHOD_NOT_FOUND')
		if (local.kind === 'error')
			return void sendRpcError(senderWs, requestId, local.message, 'EXECUTION_ERROR')

		if (ttl > 0) {
			/** @type {Record<string, unknown>} */
			const forwardPayload = {
				type: 'rpc_call',
				requestId,
				memberId,
				method,
				args,
				ttl: ttl - 1,
			}
			const targetNodeId = String(wireMessage[GROUP_RPC_TARGET_NODE_ID_KEY] || '').trim()
			if (targetNodeId) forwardPayload[GROUP_RPC_TARGET_NODE_ID_KEY] = targetNodeId.toLowerCase()
			if (forwardRpcCall(senderWs, roomKey, forwardPayload)) return
		}

		sendRpcError(senderWs, requestId, 'remote peer unreachable', 'REMOTE_UNAVAILABLE')
	}
	catch (error) {
		sendRpcError(senderWs, requestId, String(error?.message || error), 'EXECUTION_ERROR')
	}
}

/**
 * 向同群其它连接广播 rpc_call，并为发起者登记 relay 等待。
 * @param {import('npm:websocket-express').WebSocket} senderWs 发起连接
 * @param {string} roomKey 群 WS 房间键（`ownerNodeHash:groupId`，与 groupSockets 注册键一致）
 * @param {object} payload rpc_call 负载
 * @returns {boolean} 是否已向至少一个对端发出
 */
function forwardRpcCall(senderWs, roomKey, payload) {
	const set = groupSockets.get(roomKey)
	if (!set) return false
	const {requestId} = payload
	if (!requestId) return false

	const targetRaw = payload[GROUP_RPC_TARGET_NODE_ID_KEY]
	const wantDirected = !!String(targetRaw || '').trim()
	const targetNorm = wantDirected ? String(targetRaw).trim().toLowerCase() : ''

	/**
	 * @param {boolean} directedOnly 仅向登记 id 匹配的连接发送
	 * @returns {boolean} 是否至少送达一条连接
	 */
	const sendToPeers = (directedOnly) => {
		let ok = false
		const serializedPayload = JSON.stringify(payload)
		for (const peerWs of set) {
			if (peerWs === senderWs) continue
			if (directedOnly) {
				const registeredNodeId = rpcClientIdentities.get(peerWs)
				if (!registeredNodeId || registeredNodeId !== targetNorm) continue
			}
			try {
				peerWs.send(serializedPayload)
				ok = true
			}
			catch (error) {
				console.error('rpc forward failed', error)
			}
		}
		return ok
	}

	if (!sendToPeers(!!wantDirected) && !sendToPeers(false)) return false

	if (rpcRelayAwaiting.has(requestId)) return true

	const timer = setTimeout(() => {
		if (!rpcRelayAwaiting.has(requestId)) return
		rpcRelayAwaiting.delete(requestId)
		sendRpcError(senderWs, requestId, 'RPC timeout', 'TIMEOUT')
	}, RPC_RELAY_TIMEOUT_MS)

	rpcRelayAwaiting.set(requestId, { awaiterWs: senderWs, timer })
	return true
}
