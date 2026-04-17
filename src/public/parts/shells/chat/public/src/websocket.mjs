import * as Sentry from 'https://esm.sh/@sentry/browser'

import { onServerEvent } from '../../../../../scripts/server_events.mjs'
import { showToastI18n } from '../../../../../scripts/toast.mjs'

import {
	handleWorldSet,
	handlePersonaSet,
	handleCharAdded,
	handleCharRemoved,
	addPartToSelect,
	removePartFromSelect,
	handlePluginAdded,
	handlePluginRemoved,
} from './ui/sidebar.mjs'

/**
 * 当前活跃的 WebSocket 实例（由 group.mjs 通过 setActiveWebSocket 注入）。
 * @type {WebSocket | null}
 */
let activeWs = null

/** @type {Map<string, { resolve: Function, reject: Function, timer: ReturnType<typeof setTimeout>, chunks: object[] }>} */
const pendingRpc = new Map()

/** 与群 WS `group_ws_rpc_identity` / `rpc_call.targetNodeId` 对齐的本页身份（通常为 `group.mjs` 的 wsClientId）。 */
let localGroupRpcClientNodeId = null

/**
 * 设置本浏览器实例在群 RPC 定向中的身份（与发往服务器的 `group_ws_rpc_identity` 一致）。
 *
 * @param {string | null} clientNodeId UUID v4 串，或清空
 * @returns {void}
 */
export function setLocalGroupRpcClientNodeId(clientNodeId) {
	localGroupRpcClientNodeId = typeof clientNodeId === 'string' && clientNodeId ? clientNodeId.trim().toLowerCase() : null
}

/**
 * 浏览器侧：收到经群 WS 转发的 `rpc_call` 时，尝试在本地执行 Char 逻辑。
 * `(memberId, method, args) => Promise<unknown | undefined>`，返回 `undefined` 表示非本机处理。
 * @type {null | ((memberId: string, method: string, args: unknown[]) => Promise<unknown | undefined>)}
 */
let inboundRpcExecutor = null

/**
 * 注册或清空入站 RPC 执行器（离开群聊时应清空）。
 * @param {null | ((memberId: string, method: string, args: unknown[]) => Promise<unknown | undefined>)} fn 执行器
 * @returns {void}
 */
export function setInboundRpcExecutor(fn) {
	inboundRpcExecutor = fn
}

/**
 * 清理未决 RPC（切换群或断开 WS 时调用）。
 * @returns {void}
 */
export function clearPendingRpc() {
	for (const [, p] of pendingRpc) {
		clearTimeout(p.timer)
		p.reject(Object.assign(new Error('WebSocket disconnected'), { code: 'REMOTE_UNAVAILABLE' }))
	}
	pendingRpc.clear()
}

/**
 * 经群 WebSocket 发起 RPC，在收到 `rpc_end` / `rpc_error` 或超时后结束。
 *
 * @param {string} memberId 远端成员标识
 * @param {string} method 方法名
 * @param {unknown[]} [args] 参数数组（需可 JSON 序列化）
 * @param {number} [timeoutMs] 超时毫秒，默认 30000
 * @param {{ targetNodeId?: string }} [opts] 可选定向：与对端登记的 `clientNodeId` 一致时优先单播路由
 * @returns {Promise<unknown>} 对端 `rpc_end.result`
 */
export function sendRpcCall(memberId, method, args = [], timeoutMs = 30_000, opts = {}) {
	const requestId = crypto.randomUUID()
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			if (!pendingRpc.has(requestId)) return
			pendingRpc.delete(requestId)
			reject(Object.assign(new Error('RPC timeout'), { code: 'TIMEOUT' }))
			showToastI18n('warning', 'chat.group.remoteNodeTimeout')
		}, timeoutMs)
		pendingRpc.set(requestId, { resolve, reject, timer, chunks: [] })
		/** @type {Record<string, unknown>} */
		const payload = { type: 'rpc_call', requestId, memberId, method, args, ttl: 3 }
		const tid = opts?.targetNodeId
		if (typeof tid === 'string' && tid.trim()) payload.targetNodeId = tid.trim().toLowerCase()
		sendWebsocketMessage(payload)
	})
}

/**
 * 处理 `rpc_end` / `rpc_error` / `rpc_chunk`（解析出队）。
 * @param {object} msg 已解析 WS JSON
 * @returns {boolean} 是否为已消费的 RPC 响应帧
 */
export function drainGroupRpcResponses(msg) {
	if (!msg || typeof msg !== 'object') return false
	if (msg.type === 'rpc_end') {
		const pending = pendingRpc.get(msg.requestId)
		if (!pending) return false
		clearTimeout(pending.timer)
		pendingRpc.delete(msg.requestId)
		pending.resolve(msg.result)
		return true
	}
	if (msg.type === 'rpc_error') {
		const pending = pendingRpc.get(msg.requestId)
		if (!pending) return false
		clearTimeout(pending.timer)
		pendingRpc.delete(msg.requestId)
		pending.reject(Object.assign(new Error(msg.error || 'RPC error'), { code: msg.code }))
		return true
	}
	if (msg.type === 'rpc_chunk') {
		const pending = pendingRpc.get(msg.requestId)
		if (!pending) return false
		pending.chunks.push({ chunkIndex: msg.chunkIndex, data: msg.data })
		return true
	}
	return false
}

/**
 * 处理入站 `rpc_call`（在已注册 `inboundRpcExecutor` 时）。
 * @param {object} msg 已解析 WS JSON
 * @returns {Promise<boolean>} 是否已处理（含已忽略的无执行器情况）
 */
export async function handleInboundGroupRpcCall(msg) {
	if (!msg || msg.type !== 'rpc_call') return false
	const { requestId, memberId, method, args = [] } = msg
	if (!requestId || !memberId || !method) return true
	const tidRaw = msg.targetNodeId
	if (typeof tidRaw === 'string' && tidRaw.trim()) {
		const tid = tidRaw.trim().toLowerCase()
		if (!localGroupRpcClientNodeId || tid !== localGroupRpcClientNodeId) return true
	}
	if (!inboundRpcExecutor) return false
	try {
		const out = await inboundRpcExecutor(memberId, method, Array.isArray(args) ? args : [])
		if (out !== undefined)
			sendWebsocketMessage({ type: 'rpc_end', requestId, result: out })
	}
	catch (e) {
		Sentry.captureException(e)
		console.error('handleInboundGroupRpcCall failed:', e)
		sendWebsocketMessage({
			type: 'rpc_error',
			requestId,
			error: String(e?.message || e),
			code: e.code || 'EXECUTION_ERROR',
		})
	}
	return true
}

/**
 * 群 WS 消息中的 RPC 分发：先匹配出站 pending，再尝试入站执行。
 * @param {object} msg 已解析 JSON
 * @returns {Promise<boolean>} true 表示无需再走会话/DAG 等逻辑
 */
export async function handleGroupWebSocketRpc(msg) {
	if (drainGroupRpcResponses(msg)) return true
	if (msg?.type === 'rpc_call') return handleInboundGroupRpcCall(msg)
	return false
}

/**
 * 向当前活跃 WebSocket 发送消息。
 * 由 chat.mjs 的 stopGeneration 等调用。
 * @param {object} message 要序列化为 JSON 发送的对象
 * @returns {void}
 */
export function sendWebsocketMessage(message) {
	if (activeWs && activeWs.readyState === WebSocket.OPEN)
		activeWs.send(JSON.stringify(message))
	else
		console.error('WebSocket is not connected.')
}

/**
 * 由 group.mjs 在建立 WS 连接后调用，注入活跃 WS 实例供 sendWebsocketMessage 使用。
 * @param {WebSocket | null} ws 群 WebSocket 实例或清空
 * @returns {void}
 */
export function setActiveWebSocket(ws) {
	if (ws !== activeWs) clearPendingRpc()
	activeWs = ws
}

/**
 * 处理广播事件（同时处理 session 事件和 DAG 事件）。
 * 由 websocket.mjs 内部调用，也可由 group.mjs 传入事件调用。
 * @param {object} event 事件对象（含 type、payload）
 * @returns {Promise<void>}
 */
export async function handleBroadcastEvent(event) {
	const { type, payload } = event
	switch (type) {
		case 'persona_set':
			await handlePersonaSet(payload.personaname)
			break
		case 'world_set':
			await handleWorldSet(payload.worldname)
			break
		case 'char_added':
			await handleCharAdded(payload.charname)
			break
		case 'char_removed':
			await handleCharRemoved(payload.charname)
			break
		case 'plugin_added':
			await handlePluginAdded(payload.pluginname)
			break
		case 'plugin_removed':
			await handlePluginRemoved(payload.pluginname)
			break
		default:
			break
	}
}

/**
 * 初始化全局服务器事件监听（与 WS 连接无关）。
 * 实际 WS 连接由 group.mjs 的 switchGroupWebSocket 驱动。
 * @returns {void}
 */
export function initializeWebSocket() {
	onServerEvent('part-installed', ({ parttype, partname }) => {
		addPartToSelect(parttype, partname)
	})

	onServerEvent('part-uninstalled', ({ parttype, partname }) => {
		removePartFromSelect(parttype, partname)
	})
}

/**
 * 为群 WebSocket 绑定错误与关闭日志（Sentry + console）。
 * @param {WebSocket | null} ws 连接实例
 * @returns {void}
 */
export function attachGroupWebSocketErrorHandlers(ws) {
	if (!ws) return
	/**
	 * @param {Event} e 浏览器 WebSocket error 事件
	 */
	ws.onerror = e => {
		Sentry.captureException(e instanceof Error ? e : new Error('WebSocket error'))
		console.error('WebSocket error:', e)
	}
	/**
	 * @param {CloseEvent} ev 关闭事件
	 */
	ws.onclose = ev => {
		console.error('WebSocket closed:', ev.code, ev.reason)
		if (ev.code !== 1000 && ev.code !== 1001)
			Sentry.captureException(new Error(`WebSocket abnormal close: ${ev.code} ${ev.reason || ''}`))
	}
}

/**
 * 将 WebSocket 状态与 #group-ws-status 小绿点绑定。
 * @param {WebSocket | null} ws 当前 WS 实例
 * @returns {void}
 */
export function setWsStatusIndicator(ws) {
	const dot = document.getElementById('group-ws-status')
	if (!dot) return
	/**
	 * @param {string} cls 要应用的背景色类名（bg-success / bg-warning / bg-error）
	 */
	const setColor = cls => {
		dot.classList.remove('bg-success', 'bg-warning', 'bg-error')
		dot.classList.add(cls)
	}
	if (!ws) {
		setColor('bg-error')
		dot.title = 'WebSocket disconnected'
		return
	}
	setColor('bg-warning')
	dot.title = 'WebSocket connecting…'
	ws.addEventListener('open', () => {
		setColor('bg-success')
		dot.title = 'WebSocket connected'
	})
	ws.addEventListener('close', () => {
		setColor('bg-error')
		dot.title = 'WebSocket disconnected'
	})
	ws.addEventListener('error', () => {
		setColor('bg-error')
		dot.title = 'WebSocket error'
	})
}
