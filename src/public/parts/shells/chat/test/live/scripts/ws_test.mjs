// Single-node WebSocket E2E: invalid apikey rejected; valid key receives live push.
import process from 'node:process'

const BASE = process.env.FOUNT_TEST_BASE_URL || 'http://localhost:8931'
const KEY = process.env.FOUNT_API_KEY
if (!KEY) { console.error('no FOUNT_API_KEY'); process.exit(1) }

/**
 * @param {string} method HTTP 方法
 * @param {string} path 相对路径
 * @param {object} [body] JSON 体
 * @param {string} [apiKey] API key
 * @returns {Promise<{ status: number, json: object|null }>} HTTP 状态与 JSON 体
 */
async function api(method, path, body, apiKey = KEY) {
	const sep = path.includes('?') ? '&' : '?'
	const r = await fetch(`${BASE}/api/parts/shells:chat${path}${sep}fount-apikey=${apiKey}`, {
		method,
		headers: body ? { 'content-type': 'application/json' } : {},
		body: body ? JSON.stringify(body) : undefined,
	})
	let json = null
	try { json = await r.json() } catch { /* ignore */ }
	return { status: r.status, json }
}

const g = await api('POST', '/groups/', { name: 'WSTest' })
const gid = g.json.groupId
const cid = g.json.defaultChannelId
const peers = await api('GET', `/groups/${gid}/peers`)
const nodeHash = peers.json.selfNodeHash
console.log(`group=${gid} node=${nodeHash}`)

const wsBase = BASE.replace(/^http/, 'ws')
const badUrl = `${wsBase}/ws/parts/shells:chat/groups/${nodeHash}/${gid}?fount-apikey=invalid-key-on-purpose`
const badResult = await new Promise(resolve => {
	const badWs = new WebSocket(badUrl)
	const t = setTimeout(() => { badWs.close(); resolve('timeout') }, 5000)
	/**
	 *
	 */
	badWs.onopen = () => { clearTimeout(t); badWs.close(); resolve('opened') }
	/**
	 *
	 */
	badWs.onerror = () => { clearTimeout(t); resolve('error') }
	/**
	 *
	 */
	badWs.onclose = () => { clearTimeout(t); resolve('closed') }
})
if (badResult === 'opened') {
	console.error('FAIL: ws accepted invalid apikey')
	process.exit(1)
}
console.log(`PASS: invalid apikey ws result=${badResult}`)

const wsUrl = `${wsBase}/ws/parts/shells:chat/groups/${nodeHash}/${gid}?fount-apikey=${encodeURIComponent(KEY)}`
const ws = new WebSocket(wsUrl)

const received = []
let resolveDone
const done = new Promise((res) => { resolveDone = res })

const timeout = setTimeout(() => resolveDone('timeout'), 20000)

/** WebSocket 入站帧处理。
 * @param {MessageEvent} ev 入站消息事件
 */
function onWsMessage(ev) {
	let msg
	try { msg = JSON.parse(ev.data) } catch { return }
	received.push(msg.type)
	if (['channel_message', 'dag_event', 'message_replaced'].includes(msg.type)) {
		console.log(`WS received: ${msg.type}`)
		clearTimeout(timeout)
		resolveDone('ok')
	}
}

/** WebSocket 错误回调。
 * @param {Event} e 错误事件
 */
function onWsError(e) { console.log(`WS error: ${e.message || e.type}`) }

/** WebSocket 关闭回调。
 * @param {CloseEvent} e 关闭事件
 */
function onWsClose(e) { console.log(`WS close code=${e.code} reason=${e.reason}`) }

/**
 *
 */
ws.onopen = async () => {
	console.log('WS open; posting message...')
	const m = await api('POST', `/groups/${gid}/channels/${cid}/messages`, { content: { type: 'text', content: 'ws-hello' } })
	console.log(`post -> ${m.status}`)
}
ws.onmessage = onWsMessage
ws.onerror = onWsError
ws.onclose = onWsClose

const result = await done
try { ws.close() } catch { /* ignore */ }
await api('DELETE', `/groups/${gid}`)
console.log(`\nWS result=${result} types=[${[...new Set(received)].join(', ')}]`)
process.exit(result === 'ok' ? 0 : 1)
