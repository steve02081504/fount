// Single-node WebSocket E2E: valid key receives live push on group channel.
import process from 'node:process'

import { liveWsBaseUrl, requireLiveApiKey, requireLiveBaseUrl } from 'fount/scripts/test/live/env.mjs'
import { ms } from 'fount/scripts/ms.mjs'

const baseUrl = requireLiveBaseUrl()
const apiKey = requireLiveApiKey()

/**
 * 调用 Chat shell HTTP API。
 * @param {string} method - HTTP 方法。
 * @param {string} path - 相对路径。
 * @param {object} [body] - JSON 请求体。
 * @param {string} [key] - API key。
 * @returns {Promise<{ status: number, json: object | null }>} 状态码与解析后的 JSON。
 */
async function chatApi(method, path, body, key = apiKey) {
	const separator = path.includes('?') ? '&' : '?'
	const response = await fetch(`${baseUrl}/api/parts/shells:chat${path}${separator}fount-apikey=${key}`, {
		method,
		headers: body ? { 'content-type': 'application/json' } : {},
		body: body ? JSON.stringify(body) : undefined,
	})
	return { status: response.status, json: await response.json().catch(() => null) }
}

const createdGroup = await chatApi('POST', '/groups/', { name: 'WSTest' })
const groupId = createdGroup.json.groupId
const channelId = createdGroup.json.defaultChannelId
const peers = await chatApi('GET', `/groups/${groupId}/peers`)
const nodeHash = peers.json.selfNodeHash
console.log(`group=${groupId} node=${nodeHash}`)

const websocketUrl = `${liveWsBaseUrl()}/ws/parts/shells:chat/groups/${nodeHash}/${groupId}?fount-apikey=${encodeURIComponent(apiKey)}`
const websocket = new WebSocket(websocketUrl)
const receivedTypes = []
let finish
const done = new Promise(resolve => { finish = resolve })
const timeout = setTimeout(() => finish('timeout'), ms('20s'))

/** WebSocket 连接建立后发送测试消息。 */
websocket.onopen = async () => {
	console.log('WS open; posting message...')
	const post = await chatApi('POST', `/groups/${groupId}/channels/${channelId}/messages`, {
		content: { type: 'text', content: 'ws-hello' },
	})
	console.log(`post -> ${post.status}`)
}
/**
 * 处理群 WebSocket 推送消息。
 * @param {MessageEvent} event - WebSocket 消息事件。
 * @returns {void}
 */
websocket.onmessage = event => {
	const frame = JSON.parse(event.data)
	receivedTypes.push(frame.type)
	if (['channel_message', 'dag_event', 'message_replaced'].includes(frame.type)) {
		console.log(`WS received: ${frame.type}`)
		clearTimeout(timeout)
		finish('ok')
	}
}
/**
 * 记录 WebSocket 错误。
 * @param {Event} error - WebSocket 错误事件。
 * @returns {void}
 */
websocket.onerror = error => console.log(`WS error: ${error.message || error.type}`)
/**
 * 记录 WebSocket 关闭信息。
 * @param {CloseEvent} closeEvent - WebSocket 关闭事件。
 * @returns {void}
 */
websocket.onclose = closeEvent => console.log(`WS close code=${closeEvent.code} reason=${closeEvent.reason}`)

const result = await done
websocket.close()
await chatApi('DELETE', `/groups/${groupId}`)
console.log(`\nWS result=${result} types=[${[...new Set(receivedTypes)].join(', ')}]`)
process.exit(result === 'ok' ? 0 : 1)
