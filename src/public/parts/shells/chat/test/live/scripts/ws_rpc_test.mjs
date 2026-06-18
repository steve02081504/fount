// Group WebSocket RPC: rpc_call → rpc_end / rpc_error (wire 见 groupWsRpc.mjs)
import process from 'node:process'

const BASE = 'http://localhost:8931'
const KEY = process.env.FOUNT_API_KEY || '45450721'
const PREFERRED_CHARS = ['test_streamer', 'TestStreamer']

/**
 * @param {string} method HTTP 方法
 * @param {string} path chat API 路径
 * @param {object} [body] JSON 请求体
 * @returns {Promise<{ status: number, json: any }>} 响应状态与 JSON
 */
async function chatApi(method, path, body) {
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

/**
 * @param {string} method HTTP 方法
 * @param {string} path 根 API 路径
 * @returns {Promise<{ status: number, json: any }>} 响应状态与 JSON
 */
async function rootApi(method, path) {
	const sep = path.includes('?') ? '&' : '?'
	const r = await fetch(`${BASE}${path}${sep}fount-apikey=${KEY}`, { method })
	let json = null
	try { json = await r.json() } catch { /* ignore */ }
	return { status: r.status, json }
}

/**
 * @param {string[]} list 可用角色名列表
 * @returns {string|null} 优先 test_streamer，否则首个
 */
function pickChar(list) {
	if (!Array.isArray(list)) return null
	for (const name of PREFERRED_CHARS)
		if (list.includes(name)) return name
	return list[0] ?? null
}

/**
 * @param {string} reason 跳过原因
 * @returns {never} 以退出码 0 结束
 */
function skip(reason) {
	console.log(`\nSKIP: ${reason}`)
	process.exit(0)
}

/**
 * @param {boolean} ok 是否通过
 * @param {string} detail 结果说明
 * @returns {never} 以 0/1 退出
 */
function finish(ok, detail) {
	console.log(`\n${ok ? 'PASS' : 'FAIL'}: ${detail}`)
	process.exit(ok ? 0 : 1)
}

/**
 * @param {number} status HTTP 状态码
 * @returns {boolean} 是否为 2xx 成功
 */
function okStatus(status) {
	return status === 200 || status === 201
}

const who = await rootApi('GET', '/api/whoami')
if (who.status !== 200 || !who.json?.username)
	finish(false, `server unreachable or auth failed (whoami ${who.status})`)

const username = who.json.username
const charList = await rootApi('GET', '/api/getlist/chars')
const charname = pickChar(charList.json)
if (!charname) skip('no chars in getlist/chars')

const g = await chatApi('POST', '/groups/', { name: 'WSRpcTest' })
if (!okStatus(g.status) || !g.json?.groupId)
	finish(false, `create group failed (${g.status})`)

const gid = g.json.groupId
const add = await chatApi('POST', `/groups/${gid}/char`, { charname, deferGreeting: true })
if (!okStatus(add.status)) {
	await chatApi('DELETE', `/groups/${gid}`)
	skip(`cannot add char ${charname} (${add.status})`)
}

const peers = await chatApi('GET', `/groups/${gid}/peers`)
const nodeHash = peers.json?.selfNodeHash
if (!nodeHash) {
	await chatApi('DELETE', `/groups/${gid}`)
	finish(false, 'missing selfNodeHash')
}

const requestId = crypto.randomUUID()
const memberId = `${username}:${charname}`
const wsUrl = `ws://localhost:8931/ws/parts/shells:chat/groups/${nodeHash}/${gid}?fount-apikey=${KEY}`
const ws = new WebSocket(wsUrl)

const received = []
let resolveDone
const done = new Promise((res) => { resolveDone = res })
const timeout = setTimeout(() => resolveDone('timeout'), 30_000)

/**
 *
 */
ws.onopen = () => {
	console.log(`WS open; rpc_call GetData memberId=${memberId}`)
	setTimeout(() => {
		ws.send(JSON.stringify({
			type: 'rpc_call',
			requestId,
			memberId,
			method: 'GetData',
			args: [],
			ttl: 3,
		}))
	}, 750)
}
/**
 * @param {MessageEvent} ev WebSocket 消息事件
 * @returns {void}
 */
function onWsMessage(ev) {
	let msg
	try { msg = JSON.parse(ev.data) } catch { return }
	received.push(msg.type)
	if (msg.requestId !== requestId) return
	if (msg.type === 'rpc_end') {
		console.log(`rpc_end result keys=${msg.result && typeof msg.result === 'object' ? Object.keys(msg.result).join(',') : typeof msg.result}`)
		clearTimeout(timeout)
		resolveDone('ok')
	}
	if (msg.type === 'rpc_error') {
		console.log(`rpc_error code=${msg.code} error=${msg.error}`)
		clearTimeout(timeout)
		resolveDone(`error:${msg.code}`)
	}
}
ws.onmessage = onWsMessage
/**
 *
 */
ws.onerror = () => {
	clearTimeout(timeout)
	resolveDone('ws_error')
}

const result = await done
try { ws.close() } catch { /* ignore */ }
await chatApi('DELETE', `/groups/${gid}`)

console.log(`result=${result} types=[${[...new Set(received)].join(', ')}]`)
if (result === 'ok') finish(true, 'rpc_call returned rpc_end')
if (String(result).startsWith('error:')) finish(false, result)
finish(false, result)
