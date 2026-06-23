// Social feed WebSocket smoke: connect and receive hello.
import process from 'node:process'

import { liveWsBaseUrl, requireLiveApiKey } from 'fount/scripts/test/live_env.mjs'

const websocketUrl = `${liveWsBaseUrl()}/ws/parts/shells:social/feed?fount-apikey=${encodeURIComponent(requireLiveApiKey())}`

const websocket = new WebSocket(websocketUrl)
const timeout = setTimeout(() => { console.error('FAIL: ws timeout'); process.exit(1) }, 15_000)

/** @returns {void} */
websocket.onopen = () => console.log('WS open')
/**
 * @param {Event} error - WebSocket 错误事件。
 * @returns {void}
 */
websocket.onerror = error => { console.error('FAIL: ws error', error); process.exit(1) }
/**
 * @param {MessageEvent} event - WebSocket 消息事件。
 * @returns {void}
 */
websocket.onmessage = event => {
	const frame = JSON.parse(String(event.data))
	if (frame.type === 'hello') {
		console.log('PASS: received hello')
		clearTimeout(timeout)
		websocket.close()
		process.exit(0)
	}
}
