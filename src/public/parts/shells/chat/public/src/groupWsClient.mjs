/**
 * 【文件】public/src/groupWsClient.mjs
 * 【职责】当前活跃群 WebSocket 单例：出站 send、入站 RPC 执行、错误处理与 stop_generation。
 * 【原理】setActiveWebSocket 绑定 Hub 打开的 socket；setInboundRpcExecutor 分发服务端推送；attachGroupWebSocketErrorHandlers 统一 toast。
 * 【数据结构】activeGroupWebSocket、inboundRpcExecutor 回调。
 * 【关联】wsUrl.mjs；Hub WS 连接生命周期。
 */
let activeGroupWebSocket = null

/** @type {((wireMessage: object) => void | Promise<void>) | null} */
let inboundRpcExecutor = null

/**
 * 绑定出站群 WebSocket（私聊与联邦群共用同一发送口）。
 * @param {WebSocket | null} socket 群组 WS；卸载时为 null
 * @returns {void}
 */
export function setActiveWebSocket(socket) {
	activeGroupWebSocket = socket
}

/**
 * @param {((wireMessage: object) => void | Promise<void>) | null} executor 入站 RPC 执行器
 * @returns {void}
 */
export function setInboundRpcExecutor(executor) {
	inboundRpcExecutor = executor
}

/**
 * @param {WebSocket} socket 群组 WS
 * @returns {void}
 */
export function attachGroupWebSocketErrorHandlers(socket) {
	socket.addEventListener('error', event => {
		console.error('group WebSocket error:', event)
	})
}

/**
 * 经当前已绑定的群 WebSocket 发送 JSON（无连接则仅打日志）。
 * @param {object} message 消息体
 * @returns {void}
 */
export function sendWebsocketMessage(message) {
	if (activeGroupWebSocket?.readyState === WebSocket.OPEN)
		activeGroupWebSocket.send(JSON.stringify(message))
	else
		console.error('WebSocket is not connected.')
}

/**
 * 请求服务端中止流式生成（chatLog UUID 与/或 DAG event id）。
 * @param {string | { messageId?: string, dagEventId?: string }} target 停止目标
 * @returns {void}
 */
export function stopGeneration(target) {
	const messageId = String(target?.messageId || '').trim()
	const dagEventId = String(target?.dagEventId || '').trim()
	if (!messageId && !dagEventId) return
	sendWebsocketMessage({
		type: 'stop_generation',
		payload: {
			messageId: messageId || undefined,
			dagEventId: dagEventId || undefined,
		},
	})
}

/**
 * 消费群 WS 上的 `rpc_call`。
 * @param {object} wireMessage 已解析 JSON
 * @returns {Promise<boolean>} true 表示已消费
 */
export async function handleGroupWebSocketRpc(wireMessage) {
	if (wireMessage?.type !== 'rpc_call' || !inboundRpcExecutor)
		return false
	await inboundRpcExecutor(wireMessage)
	return true
}
