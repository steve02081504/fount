// Social feed WebSocket smoke: connect and receive hello.
import process from 'node:process'

import { ms } from 'fount/scripts/ms.mjs'
import { liveWsBaseUrl, requireLiveApiKey } from 'fount/scripts/test/live/env.mjs'

const websocketUrl = `${liveWsBaseUrl()}/ws/parts/shells:social/feed?fount-apikey=${encodeURIComponent(requireLiveApiKey())}`

const websocket = new WebSocket(websocketUrl)
const timeout = setTimeout(() => { console.error('FAIL: ws timeout'); process.exit(1) }, ms('15s'))

/**
 * WebSocket 连接建立。
 * @returns {void}
 */
websocket.onopen = () => console.log('WS open')
/**
 * 连接失败时终止测试。
 * @param {Event} error - WebSocket 错误事件。
 * @returns {void}
 */
websocket.onerror = error => { console.error('FAIL: ws error', error); process.exit(1) }
/**
 * 收到 hello 帧时判定通过。
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
