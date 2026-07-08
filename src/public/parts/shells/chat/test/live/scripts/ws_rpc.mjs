// Group WebSocket RPC: rpc_call → rpc_end / rpc_error (wire 见 groupWsRpc.mjs)
import { ms } from 'fount/scripts/ms.mjs'
import { liveWsBaseUrl, requireLiveApiKey, requireLiveBaseUrl } from 'fount/scripts/test/live/env.mjs'
import { failLiveWsPrecondition, finishLiveWs, pickPreferredChar } from 'fount/scripts/test/live/wsHarness.mjs'

const BASE = requireLiveBaseUrl()
const KEY = requireLiveApiKey()
const PREFERRED_CHARS = ['test_streamer', 'TestStreamer']

/**
 * 调用 Chat shell HTTP API。
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
 * 调用根 API。
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
 * 判断 HTTP 状态是否为成功。
 * @param {number} status HTTP 状态码
 * @returns {boolean} 是否为 2xx 成功
 */
function okStatus(status) {
	return status === 200 || status === 201
}

const who = await rootApi('GET', '/api/whoami')
if (who.status !== 200 || !who.json?.username)
	finishLiveWs(false, `server unreachable or auth failed (whoami ${who.status})`)

const username = who.json.username
const charList = await rootApi('GET', '/api/getlist/chars')
const charname = pickPreferredChar(charList.json, PREFERRED_CHARS)
if (!charname) failLiveWsPrecondition('no chars in getlist/chars (test_streamer fixture missing?)')

const g = await chatApi('POST', '/groups/', { name: 'WSRpcTest' })
if (!okStatus(g.status) || !g.json?.groupId)
	finishLiveWs(false, `create group failed (${g.status})`)

const gid = g.json.groupId
const add = await chatApi('POST', `/groups/${gid}/char`, { charname, deferGreeting: true })
if (!okStatus(add.status)) {
	await chatApi('DELETE', `/groups/${gid}`)
	failLiveWsPrecondition(`cannot add char ${charname} (${add.status})`)
}

const peers = await chatApi('GET', `/groups/${gid}/peers`)
const nodeHash = peers.json?.selfNodeHash
if (!nodeHash) {
	await chatApi('DELETE', `/groups/${gid}`)
	finishLiveWs(false, 'missing selfNodeHash')
}

const requestId = crypto.randomUUID()
const memberId = `${username}:${charname}`
const wsUrl = `${liveWsBaseUrl()}/ws/parts/shells:chat/groups/${nodeHash}/${gid}?fount-apikey=${KEY}`
const ws = new WebSocket(wsUrl)

const received = []
let resolveDone
const done = new Promise((res) => { resolveDone = res })
const timeout = setTimeout(() => resolveDone('timeout'), ms('30s'))

/**
 * WebSocket 连接建立后发送 rpc_call。
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
 * 处理 WebSocket RPC 响应消息。
 * @param {MessageEvent} ev WebSocket 消息事件
 * @returns {void}
 */
function onWsMessage(ev) {
	let message
	try { message = JSON.parse(ev.data) } catch { return }
	received.push(message.type)
	if (message.requestId !== requestId) return
	if (message.type === 'rpc_end') {
		console.log(`rpc_end result keys=${message.result?.constructor === Object ? Object.keys(message.result).join(',') : typeof message.result}`)
		clearTimeout(timeout)
		resolveDone('ok')
	}
	if (message.type === 'rpc_error') {
		console.log(`rpc_error code=${message.code} error=${message.error}`)
		clearTimeout(timeout)
		resolveDone(`error:${message.code}`)
	}
}
ws.onmessage = onWsMessage
/**
 * WebSocket 错误时结束等待。
 */
ws.onerror = () => {
	clearTimeout(timeout)
	resolveDone('ws_error')
}

const result = await done
try { ws.close() } catch { /* ignore */ }
await chatApi('DELETE', `/groups/${gid}`)

console.log(`result=${result} types=[${[...new Set(received)].join(', ')}]`)
if (result === 'ok') finishLiveWs(true, 'rpc_call returned rpc_end')
if (String(result).startsWith('error:')) finishLiveWs(false, result)
finishLiveWs(false, result)
