// Social feed WebSocket smoke: connect and receive hello.
import process from 'node:process'

const BASE = process.env.FOUNT_TEST_BASE_URL || 'http://localhost:8931'
const KEY = process.env.FOUNT_API_KEY
if (!KEY) { console.error('no FOUNT_API_KEY'); process.exit(1) }

const wsBase = BASE.replace(/^http/, 'ws')
const wsUrl = `${wsBase}/ws/parts/shells:social/feed?fount-apikey=${encodeURIComponent(KEY)}`

const ws = new WebSocket(wsUrl)
const timeout = setTimeout(() => { console.error('FAIL: ws timeout'); process.exit(1) }, 15000)

/** Feed hello 帧处理。
 * @param {MessageEvent} ev 入站消息事件
 */
function onFeedMessage(ev) {
	const msg = JSON.parse(String(ev.data))
	if (msg.type === 'hello') {
		console.log('PASS: received hello')
		clearTimeout(timeout)
		ws.close()
		process.exit(0)
	}
}

/** WebSocket 错误回调。
 * @param {Event} err 错误事件
 */
function onFeedError(err) {
	console.error('FAIL: ws error', err)
	process.exit(1)
}

/** WebSocket 连接建立。
 * @returns {void}
 */
function onFeedOpen() { console.log('WS open') }

ws.onopen = onFeedOpen
ws.onmessage = onFeedMessage
ws.onerror = onFeedError
