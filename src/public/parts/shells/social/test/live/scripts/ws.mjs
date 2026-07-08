// Social feed WebSocket: hello + live post push after HTTP write.
import process from 'node:process'

import { ms } from 'fount/scripts/ms.mjs'
import { liveWsBaseUrl, requireLiveApiKey, requireLiveBaseUrl } from 'fount/scripts/test/live/env.mjs'

const baseUrl = requireLiveBaseUrl()
const apiKey = requireLiveApiKey()

/**
 * 调用 Social shell HTTP API。
 * @param {string} method HTTP 方法
 * @param {string} path 相对路径
 * @param {object} [body] JSON 请求体
 * @returns {Promise<{ status: number, json: object | null }>} HTTP 状态与 JSON 体
 */
async function socialApi(method, path, body) {
	const separator = path.includes('?') ? '&' : '?'
	const response = await fetch(`${baseUrl}/api/parts/shells:social${path}${separator}fount-apikey=${encodeURIComponent(apiKey)}`, {
		method,
		headers: body ? { 'content-type': 'application/json' } : {},
		body: body ? JSON.stringify(body) : undefined,
	})
	return { status: response.status, json: await response.json().catch(() => null) }
}

const viewer = await socialApi('GET', '/viewer')
if (viewer.status !== 200 || !viewer.json?.viewerEntityHash) {
	console.error('FAIL: GET /viewer', viewer.status, viewer.json)
	process.exit(1)
}
const entityHash = viewer.json.viewerEntityHash

const websocketUrl = `${liveWsBaseUrl()}/ws/parts/shells:social/feed?fount-apikey=${encodeURIComponent(apiKey)}`
const websocket = new WebSocket(websocketUrl)
const receivedTypes = []
let finish
const done = new Promise(resolve => { finish = resolve })
const timeout = setTimeout(() => finish('timeout'), ms('20s'))

/** WS 连接建立后发帖，等待 post 推送。 */
websocket.onopen = async () => {
	console.log('WS open; posting...')
	const post = await socialApi('POST', '/posts', {
		entityHash,
		text: `ws-push ${Date.now()}`,
		visibility: 'public',
		lang: 'zh-CN',
	})
	console.log(`post -> ${post.status}`)
	if (post.status !== 200) finish('post_failed')
}
/**
 * 记录收到的 WS 帧类型；hello 与 post 均满足通过条件。
 * @param {MessageEvent} event WebSocket 消息
 * @returns {void}
 */
websocket.onmessage = event => {
	const frame = JSON.parse(String(event.data))
	receivedTypes.push(frame.type)
	if (frame.type === 'hello') console.log('PASS: received hello')
	if (frame.type === 'post') {
		console.log('PASS: received post push')
		clearTimeout(timeout)
		finish('ok')
	}
}
/**
 * @param {Event} error WebSocket 错误
 * @returns {void}
 */
websocket.onerror = error => console.error('FAIL: ws error', error)

const result = await done
websocket.close()
console.log(`\nWS result=${result} types=[${[...new Set(receivedTypes)].join(', ')}]`)
process.exit(result === 'ok' ? 0 : 1)
