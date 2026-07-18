/**
 * 【文件】public/hub/stream/outbound.mjs
 * 【职责】当前群 WebSocket 出站：typing / stop_generation / 通用 JSON send。
 * 【原理】读写 connectionState.groupWebSocket；与 connection.mjs 生命周期共用同一句柄。
 */
import * as conn from './connectionState.mjs'

/**
 * @param {object} message 消息体
 * @returns {void}
 */
export function sendWebsocketMessage(message) {
	if (conn.groupWebSocket?.readyState === WebSocket.OPEN)
		conn.groupWebSocket.send(JSON.stringify(message))
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
	if (conn.groupWebSocket?.readyState !== WebSocket.OPEN) return
	lastTypingReportAt = now
	conn.groupWebSocket.send(JSON.stringify({
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

/**
 * @param {WebSocket} socket 群组 WS
 * @returns {void}
 */
export function attachGroupWebSocketErrorHandlers(socket) {
	socket.addEventListener('error', event => {
		console.error('group WebSocket error:', event)
	})
}
