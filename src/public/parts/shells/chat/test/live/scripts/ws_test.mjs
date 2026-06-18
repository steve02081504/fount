// Single-node WebSocket E2E: connect group UI socket, post message via HTTP, expect live push.
import process from 'node:process'

const BASE = 'http://localhost:8931'
const KEY = process.env.FOUNT_API_KEY
if (!KEY) { console.error('no FOUNT_API_KEY'); process.exit(1) }

/**
 * Chat REST API 调用封装。
 * @param {string} method HTTP 方法
 * @param {string} path 相对路径（不含 /api/parts/shells:chat 前缀）
 * @param {object} [body] JSON 请求体
 * @returns {Promise<{ status: number, json: object|null }>} HTTP 响应状态与 JSON 体
 */
async function api(method, path, body) {
	const sep = path.includes('?') ? '&' : '?'
	const r = await fetch(`${BASE}/api/parts/shells:chat${path}${sep}fount-apikey=${KEY}`, {
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

const wsUrl = `ws://localhost:8931/ws/parts/shells:chat/groups/${nodeHash}/${gid}?fount-apikey=${KEY}`
const ws = new WebSocket(wsUrl)

const received = []
let resolveDone
const done = new Promise((res) => { resolveDone = res })

const timeout = setTimeout(() => resolveDone('timeout'), 20000)

/**
 *
 */
ws.onopen = async () => {
	console.log('WS open; posting message...')
	const m = await api('POST', `/groups/${gid}/channels/${cid}/messages`, { content: { type: 'text', content: 'ws-hello' } })
	console.log(`post -> ${m.status}`)
}
/** @param {MessageEvent} ev WebSocket 入站帧 */
ws.onmessage = (ev) => {
	let msg
	try { msg = JSON.parse(ev.data) } catch { return }
	received.push(msg.type)
	if (['channel_message', 'dag_event', 'message_replaced'].includes(msg.type)) {
		console.log(`WS received: ${msg.type}`)
		clearTimeout(timeout)
		resolveDone('ok')
	}
}
/** @param {Event} e WebSocket 错误事件 */
ws.onerror = (e) => { console.log(`WS error: ${e.message || e.type}`) }
/** @param {CloseEvent} e WebSocket 关闭事件 */
ws.onclose = (e) => { console.log(`WS close code=${e.code} reason=${e.reason}`) }

const result = await done
try { ws.close() } catch { /* ignore */ }
await api('DELETE', `/groups/${gid}`)
console.log(`\nWS result=${result} types=[${[...new Set(received)].join(', ')}]`)
process.exit(result === 'ok' ? 0 : 1)
