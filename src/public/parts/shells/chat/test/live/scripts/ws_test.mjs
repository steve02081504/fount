// Single-node WebSocket E2E: invalid apikey rejected; valid key receives live push.
import process from 'node:process'

import { liveWsBaseUrl, requireLiveApiKey, requireLiveBaseUrl } from 'fount/scripts/test/live_env.mjs'

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

const invalidKeyUrl = `${liveWsBaseUrl()}/ws/parts/shells:chat/groups/${nodeHash}/${groupId}?fount-apikey=invalid-key-on-purpose`
const invalidKeyResult = await new Promise(resolve => {
	const socket = new WebSocket(invalidKeyUrl)
	const timer = setTimeout(() => { socket.close(); resolve('timeout') }, 5000)
	/** @returns {void} */
	socket.onopen = () => { clearTimeout(timer); socket.close(); resolve('opened') }
	/** @returns {void} */
	socket.onerror = () => { clearTimeout(timer); resolve('error') }
	/** @returns {void} */
	socket.onclose = () => { clearTimeout(timer); resolve('closed') }
})
if (invalidKeyResult === 'opened') {
	console.error('FAIL: ws accepted invalid apikey')
	process.exit(1)
}
console.log(`PASS: invalid apikey ws result=${invalidKeyResult}`)

const websocketUrl = `${liveWsBaseUrl()}/ws/parts/shells:chat/groups/${nodeHash}/${groupId}?fount-apikey=${encodeURIComponent(apiKey)}`
const websocket = new WebSocket(websocketUrl)
const receivedTypes = []
let finish
const done = new Promise(resolve => { finish = resolve })
const timeout = setTimeout(() => finish('timeout'), 20_000)

/** @returns {Promise<void>} */
websocket.onopen = async () => {
	console.log('WS open; posting message...')
	const post = await chatApi('POST', `/groups/${groupId}/channels/${channelId}/messages`, {
		content: { type: 'text', content: 'ws-hello' },
	})
	console.log(`post -> ${post.status}`)
}
/**
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
 * @param {Event} error - WebSocket 错误事件。
 * @returns {void}
 */
websocket.onerror = error => console.log(`WS error: ${error.message || error.type}`)
/**
 * @param {CloseEvent} closeEvent - WebSocket 关闭事件。
 * @returns {void}
 */
websocket.onclose = closeEvent => console.log(`WS close code=${closeEvent.code} reason=${closeEvent.reason}`)

const result = await done
websocket.close()
await chatApi('DELETE', `/groups/${groupId}`)
console.log(`\nWS result=${result} types=[${[...new Set(receivedTypes)].join(', ')}]`)
process.exit(result === 'ok' ? 0 : 1)
