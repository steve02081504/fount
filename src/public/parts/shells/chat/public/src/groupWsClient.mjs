/**
 * 【文件】public/src/groupWsClient.mjs
 * 【职责】当前活跃群 WebSocket 单例：出站 send、错误处理与 stop_generation。
 * 【原理】setActiveWebSocket 绑定 Hub 打开的 socket；attachGroupWebSocketErrorHandlers 统一日志。
 * 【数据结构】activeGroupWebSocket。
 * 【关联】wsUrl.mjs；Hub WS 连接生命周期。
 */
let activeGroupWebSocket = null

/**
 * 绑定出站群 WebSocket（私聊与联邦群共用同一发送口）。
 * @param {WebSocket | null} socket 群组 WS；卸载时为 null
 * @returns {void}
 */
export function setActiveWebSocket(socket) {
	activeGroupWebSocket = socket
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

/** 上次 typing 上报时间戳（volatile 节流，TTL 6s / 节流 3s）。 */
let lastTypingReportAt = 0

/**
 * 上报本人正在输入（volatile，不入 DAG；服务端入账 typingUsers）。
 * @param {string} channelId 频道 ID
 * @returns {void}
 */
export function reportTyping(channelId) {
	const now = Date.now()
	if (now - lastTypingReportAt < 3000) return
	if (activeGroupWebSocket?.readyState !== WebSocket.OPEN) return
	lastTypingReportAt = now
	activeGroupWebSocket.send(JSON.stringify({
		type: 'typing',
		payload: { channelId: channelId || 'default' },
	}))
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
