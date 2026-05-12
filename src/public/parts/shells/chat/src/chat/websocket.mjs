import { createHash } from 'node:crypto'

import { createVolatileStreamBuffer } from '../../../../../../scripts/p2p/volatile_streams.mjs'

import { GROUP_RPC_TARGET_NODE_ID_KEY, isValidGroupRpcClientNodeId } from './remoteProxy.mjs'
import { tryInvokeLocalCharRpc } from './session.mjs'

// ─── IP 限流 ────────────────────────────────────────────────────────────────

/** IP 限流：{ip} -> { count, resetAt } */
const ipWsRequests = new Map()
const IP_WS_WINDOW_MS = 60_000
const IP_WS_MAX = 60

/**
 * WS 升级前 IP 限流检查（每分钟最多 60 次）。
 *
 * @param {string} ip 客户端 IP（可取 X-Forwarded-For 首段）
 * @returns {boolean} true=允许，false=拒绝
 */
export function checkWsRateLimit(ip) {
	const now = Date.now()
	let entry = ipWsRequests.get(ip)
	if (!entry || now > entry.resetAt) {
		entry = { count: 0, resetAt: now + IP_WS_WINDOW_MS }
		ipWsRequests.set(ip, entry)
	}
	entry.count++
	return entry.count <= IP_WS_MAX
}

// ─── PoW 质询 ───────────────────────────────────────────────────────────────

/** GET /pow-challenge 下发的质询，单次使用 */
/** @type {Map<string, { challenge: string, expires: number }>} */
const powChallenges = new Map()

/**
 * PoW 质询在内存 Map 中的复合键
 *
 * @param {string} username 用户名
 * @param {string} groupId 群组 id
 * @returns {string} 内部 Map 键
 */
function powChallengeKey(username, groupId) {
	return `${username}\0${groupId}`
}

/**
 * 注册 PoW 质询（由 GET …/pow-challenge 调用，约 10 分钟内有效）。
 *
 * @param {string} username 用户名
 * @param {string} groupId 群组 id
 * @param {string} challenge 服务端下发的随机质询串
 * @param {number} [ttlMs] 过期毫秒数，默认 10 分钟
 * @returns {void}
 */
export function setPowChallenge(username, groupId, challenge, ttlMs = 600_000) {
	powChallenges.set(powChallengeKey(username, groupId), {
		challenge,
		expires: Date.now() + ttlMs,
	})
}

/**
 * 校验 PoW：`sha256(utf8(\`${groupId}:${challenge}:${nonce}\`))` 的 hex 字符串前 `difficulty` 个字符均为 `0`。
 * 须与已注册的 challenge 一致，通过后删除质询（单次使用）。
 *
 * @param {string} username 用户名（与注册质询时一致）
 * @param {string} groupId 群组 id
 * @param {number} difficulty 0–64，为 0 时视为不校验
 * @param {{ challenge?: unknown, nonce?: unknown }} [powSolution] 客户端提交的质询与 nonce
 * @returns {boolean} 校验通过或难度为 0 时为 true；否则 false
 */
export function verifyPowSolution(username, groupId, difficulty, powSolution) {
	const d = Math.max(0, Math.min(64, Math.floor(Number(difficulty) || 0)))
	if (d <= 0) return true
	if (!powSolution || typeof powSolution !== 'object') return false
	const ch = powSolution.challenge
	const nonce = powSolution.nonce
	if (ch == null || nonce == null) return false
	const key = powChallengeKey(username, groupId)
	const entry = powChallenges.get(key)
	if (!entry || entry.expires < Date.now()) return false
	if (String(ch) !== entry.challenge) return false
	const hex = createHash('sha256')
		.update(`${groupId}:${String(ch)}:${String(nonce)}`, 'utf8')
		.digest('hex')
	if (!hex.startsWith('0'.repeat(d))) return false
	powChallenges.delete(key)
	return true
}

// ─── WebSocket 广播 ──────────────────────────────────────────────────────────

/** @type {Map<string, Set<import('npm:websocket-express').WebSocket>>} */
const sockets = new Map()

/** 群 WS 连接登记的 RPC 客户端身份（浏览器 `clientNodeId`），供定向转发。 */
/** @type {WeakMap<import('npm:websocket-express').WebSocket, string>} */
const rpcClientIdentities = new WeakMap()

/**
 * 登记群 WebSocket 的 RPC 定向身份（由客户端首包 `group_ws_rpc_identity` 上报）。
 *
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
 *
 * @param {import('npm:websocket-express').WebSocket} ws 当前连接
 * @param {object} msg 已解析 JSON
 * @returns {boolean} true 表示已消费该帧
 */
export function handleGroupSocketIdentityMessage(ws, msg) {
	if (!msg || typeof msg !== 'object') return false
	if (msg.type !== 'group_ws_rpc_identity') return false
	const id = msg.clientNodeId
	registerRpcClientIdentity(ws, id)
	return true
}

/**
 * 将 WebSocket 登记到群组房间，连接关闭时自动移除
 *
 * @param {string} chatId 群组 id（与 WS URL 中 groupId 一致）
 * @param {import('npm:websocket-express').WebSocket} ws 已建立的 WS 连接
 * @returns {void}
 */
export function registerSocket(chatId, ws) {
	if (!sockets.has(chatId)) sockets.set(chatId, new Set())
	sockets.get(chatId).add(ws)
	ws.on('close', () => {
		sockets.get(chatId)?.delete(ws)
	})
}

/**
 * 当前群在 shell WS 上已连接的客户端数（含 Hub / 群 UI / RPC）。
 * @param {string} chatId 群组 id
 * @returns {number} 连接数，无房间时为 0
 */
export function countGroupSockets(chatId) {
	return sockets.get(chatId)?.size ?? 0
}

/**
 * 向某群组下所有已连接 WS 广播 JSON 消息（带时间戳字段 t）
 *
 * @param {string} chatId 群组 id
 * @param {object} payload 业务负载（会浅拷贝并附加 `t`）
 * @returns {void}
 */
export function broadcastEvent(chatId, payload) {
	const set = sockets.get(chatId)
	if (!set) return
	const raw = JSON.stringify({ ...payload, t: Date.now() })
	for (const ws of set)
		try {
			ws.send(raw)
		}
		catch (e) {
			console.error('broadcast failed', e)
		}
}

// ─── 流式 AI chunk 短窗口缓冲（VOLATILE best-effort；不提供联邦 stream_chunk_nack，§6.4）────────

/**
 * `${chatId}:${pendingStreamId}` -> VolatileStreamBuffer
 * @type {Map<string, ReturnType<typeof createVolatileStreamBuffer>>}
 */
const streamBuffers = new Map()

/**
 * 流式缓冲在内存 Map 中的复合键
 *
 * @param {string} chatId 群组 id
 * @param {string} pendingStreamId 流标识（与客户端 pendingStreamId 一致）
 * @returns {string} 内部 Map 键
 */
function streamBufferKey(chatId, pendingStreamId) {
	return `${chatId}\0${pendingStreamId}`
}

/**
 * 将 AI 流式 chunk 存入服务端缓冲（短保留；无 NACK 补传语义）。
 *
 * @param {string} chatId 群组 id
 * @param {string} pendingStreamId 流标识
 * @param {number} chunkSeq 分片序号（从 1 递增）
 * @param {string} text 本分片正文
 * @returns {void}
 */
export function bufferStreamChunk(chatId, pendingStreamId, chunkSeq, text) {
	const key = streamBufferKey(chatId, pendingStreamId)
	if (!streamBuffers.has(key))
		streamBuffers.set(key, createVolatileStreamBuffer())
	streamBuffers.get(key).addChunk(pendingStreamId, chunkSeq, text)
}

/**
 * 标记流结束，60 秒后自动清理缓冲。
 *
 * @param {string} chatId 群组 id
 * @param {string} pendingStreamId 流标识
 * @returns {void}
 */
export function finishStreamBuffer(chatId, pendingStreamId) {
	const key = streamBufferKey(chatId, pendingStreamId)
	const buf = streamBuffers.get(key)
	if (buf) {
		buf.end(pendingStreamId)
		setTimeout(() => {
			buf.clear(pendingStreamId)
			streamBuffers.delete(key)
		}, 60_000)
	}
}

/**
 * 取单个已缓冲 chunk（调试/扩展用；主路径不依赖 NACK）。
 *
 * @param {string} chatId 群组 id
 * @param {string} pendingStreamId 流标识
 * @param {number} chunkSeq 分片序号
 * @returns {string | null} 已缓冲的正文；无记录则为 null
 */
export function getBufferedChunk(chatId, pendingStreamId, chunkSeq) {
	const key = streamBufferKey(chatId, pendingStreamId)
	return streamBuffers.get(key)?.getChunk(pendingStreamId, chunkSeq) ?? null
}

// ─── 群 WebSocket：跨节点 Char RPC ─────────────────────────────────────────

const RPC_RELAY_TIMEOUT_MS = 30_000

/**
 * `requestId` -> 首次转发 rpc_call 时登记，待任意节点回 rpc_end / rpc_error 后回写给发起者
 * @type {Map<string, { awaiterWs: import('npm:websocket-express').WebSocket, timer: ReturnType<typeof setTimeout> }>}
 */
const rpcRelayAwaiting = new Map()

/**
 * 将 rpc_end / rpc_error / rpc_chunk 转发给仍在等待 relay 的发起连接。
 *
 * @param {string} _groupId 群组 id（预留）
 * @param {import('npm:websocket-express').WebSocket} _fromWs 来源 WS（预留）
 * @param {object} msg 已解析 JSON
 * @returns {boolean} 已消费（属于 relay 或不应再走其它逻辑）
 */
export function relayOrConsumeRpcResponse(_groupId, _fromWs, msg) {
	if (!msg || typeof msg !== 'object') return false
	const t = msg.type
	if (t !== 'rpc_end' && t !== 'rpc_error' && t !== 'rpc_chunk') return false
	const requestId = msg.requestId
	if (typeof requestId !== 'string' || !requestId) return false

	const pending = rpcRelayAwaiting.get(requestId)
	if (!pending) return false

	try {
		pending.awaiterWs.send(JSON.stringify(msg))
	}
	catch (e) {
		console.error('rpc relay send failed', e)
	}

	if (t === 'rpc_chunk') return true

	clearTimeout(pending.timer)
	rpcRelayAwaiting.delete(requestId)
	return true
}

/**
 * 处理客户端经群 WS 发来的 RPC 控制帧（应在其它业务 switch 之前调用）。
 *
 * @param {string} groupId 群组 id
 * @param {import('npm:websocket-express').WebSocket} ws 当前连接
 * @param {object} msg 已解析 JSON
 * @returns {boolean} true 表示已处理，调用方应跳过后续 switch
 */
export function handleGroupSocketRpcMessage(groupId, ws, msg) {
	if (!msg || typeof msg !== 'object') return false
	if (msg.type === 'rpc_end' || msg.type === 'rpc_error' || msg.type === 'rpc_chunk')
		return relayOrConsumeRpcResponse(groupId, ws, msg)

	if (msg.type !== 'rpc_call') return false

	const { requestId, memberId, method } = msg
	if (!requestId || !memberId || !method) return true

	void handleRpcCall(ws, groupId, msg)
	return true
}

/**
 * @param {import('npm:websocket-express').WebSocket} senderWs 发起方
 * @param {string} groupId 群组 id
 * @param {object} msg 原始 `rpc_call` 消息（保留 `targetNodeId` 等扩展字段）
 * @returns {Promise<void>}
 */
async function handleRpcCall(senderWs, groupId, msg) {
	const { requestId, memberId, method, args = [], ttl = 3 } = msg
	try {
		const local = await tryInvokeLocalCharRpc(groupId, memberId, method, args)
		if (local.kind === 'result') {
			try {
				senderWs.send(JSON.stringify({ type: 'rpc_end', requestId, result: local.value }))
			}
			catch (e) {
				console.error('rpc_end send failed', e)
			}
			return
		}
		if (local.kind === 'method_not_found') {
			try {
				senderWs.send(JSON.stringify({
					type: 'rpc_error',
					requestId,
					error: '方法不存在',
					code: 'METHOD_NOT_FOUND',
				}))
			}
			catch (e) {
				console.error('rpc_error send failed', e)
			}
			return
		}
		if (local.kind === 'error') {
			try {
				senderWs.send(JSON.stringify({
					type: 'rpc_error',
					requestId,
					error: local.message,
					code: 'EXECUTION_ERROR',
				}))
			}
			catch (e) {
				console.error('rpc_error send failed', e)
			}
			return
		}

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
			const tid = msg[GROUP_RPC_TARGET_NODE_ID_KEY]
			if (typeof tid === 'string' && tid.trim()) forwardPayload[GROUP_RPC_TARGET_NODE_ID_KEY] = tid.trim().toLowerCase()
			const forwarded = forwardRpcCall(senderWs, groupId, forwardPayload)
			if (forwarded) return
		}

		try {
			senderWs.send(JSON.stringify({
				type: 'rpc_error',
				requestId,
				error: '远端不可达',
				code: 'REMOTE_UNAVAILABLE',
			}))
		}
		catch (e) {
			console.error('rpc_error send failed', e)
		}
	}
	catch (e) {
		try {
			senderWs.send(JSON.stringify({
				type: 'rpc_error',
				requestId,
				error: String(e?.message || e),
				code: 'EXECUTION_ERROR',
			}))
		}
		catch (e2) {
			console.error('rpc_error send failed', e2)
		}
	}
}

/**
 * 向同群其它连接广播 rpc_call，并为发起者登记 relay 等待。
 *
 * @param {import('npm:websocket-express').WebSocket} senderWs 发起连接
 * @param {string} groupId 群组 id
 * @param {object} payload rpc_call 负载
 * @returns {boolean} 是否已向至少一个对端发出
 */
function forwardRpcCall(senderWs, groupId, payload) {
	const set = sockets.get(groupId)
	if (!set) return false
	const requestId = payload.requestId
	if (typeof requestId !== 'string' || !requestId) return false

	const targetRaw = payload[GROUP_RPC_TARGET_NODE_ID_KEY]
	const wantDirected = typeof targetRaw === 'string' && targetRaw.length > 0
	const targetNorm = wantDirected ? targetRaw.trim().toLowerCase() : ''

	/**
	 * @param {boolean} directedOnly 仅向登记 id 匹配的连接发送
	 * @returns {boolean} 是否至少送达一条连接
	 */
	const sendToPeers = (directedOnly) => {
		let ok = false
		const raw = JSON.stringify(payload)
		for (const peerWs of set) {
			if (peerWs === senderWs) continue
			if (directedOnly) {
				const reg = rpcClientIdentities.get(peerWs)
				if (!reg || reg !== targetNorm) continue
			}
			try {
				peerWs.send(raw)
				ok = true
			}
			catch (e) {
				console.error('rpc forward failed', e)
			}
		}
		return ok
	}

	let forwarded = false
	if (wantDirected) {
		forwarded = sendToPeers(true)
		if (!forwarded) forwarded = sendToPeers(false)
	}
	else forwarded = sendToPeers(false)

	if (!forwarded) return false

	if (rpcRelayAwaiting.has(requestId)) return true

	const timer = setTimeout(() => {
		if (!rpcRelayAwaiting.has(requestId)) return
		rpcRelayAwaiting.delete(requestId)
		try {
			senderWs.send(JSON.stringify({
				type: 'rpc_error',
				requestId,
				error: 'RPC timeout',
				code: 'TIMEOUT',
			}))
		}
		catch (e) {
			console.error('rpc timeout send failed', e)
		}
	}, RPC_RELAY_TIMEOUT_MS)

	rpcRelayAwaiting.set(requestId, { awaiterWs: senderWs, timer })
	return true
}
