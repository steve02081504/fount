// Group WebSocket stream: trigger-reply → stream_chunk and/or message_replaced finish
import { liveWsBaseUrl, requireLiveApiKey, requireLiveBaseUrl } from 'fount/scripts/test/live_env.mjs'

const BASE = requireLiveBaseUrl()
const KEY = requireLiveApiKey()
const PREFERRED_CHARS = ['test_streamer', 'TestStreamer']
const TIMEOUT_MS = 120_000

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
 * @param {number} status HTTP 状态码
 * @returns {boolean} 是否为 2xx 成功
 */
function okStatus(status) {
	return status === 200 || status === 201
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

const who = await rootApi('GET', '/api/whoami')
if (who.status !== 200) finish(false, `server unreachable (whoami ${who.status})`)

const charname = pickChar((await rootApi('GET', '/api/getlist/chars')).json)
if (!charname) skip('no chars in getlist/chars')

const g = await chatApi('POST', '/groups/', { name: 'WSStreamTest' })
if (!okStatus(g.status) || !g.json?.groupId) finish(false, `create group failed (${g.status})`)

const gid = g.json.groupId
const cid = g.json.defaultChannelId
const add = await chatApi('POST', `/groups/${gid}/char`, { charname, deferGreeting: true })
if (!okStatus(add.status)) {
	await chatApi('DELETE', `/groups/${gid}`)
	skip(`cannot add char ${charname} (${add.status})`)
}

const msg = await chatApi('POST', `/groups/${gid}/channels/${cid}/messages`, {
	content: { type: 'text', content: 'ws-stream probe' },
})
if (!okStatus(msg.status)) {
	await chatApi('DELETE', `/groups/${gid}`)
	finish(false, `post message failed (${msg.status})`)
}

const peers = await chatApi('GET', `/groups/${gid}/peers`)
const nodeHash = peers.json?.selfNodeHash
if (!nodeHash) {
	await chatApi('DELETE', `/groups/${gid}`)
	finish(false, 'missing selfNodeHash')
}

const wsUrl = `${liveWsBaseUrl()}/ws/parts/shells:chat/groups/${nodeHash}/${gid}?fount-apikey=${KEY}`
const ws = new WebSocket(wsUrl)

const received = []
let pendingStreamId = null
let sawStreamChunk = false
let sawFinish = false
let resolveDone
const done = new Promise((res) => { resolveDone = res })
const timeout = setTimeout(() => resolveDone('timeout'), TIMEOUT_MS)

/**
 * 收到 stream_chunk 或 finish 事件时结束等待。
 * @returns {void}
 */
function maybeResolve() {
	if (sawStreamChunk || sawFinish) {
		clearTimeout(timeout)
		resolveDone('ok')
	}
}

/**
 *
 */
ws.onopen = () => {
	console.log(`WS open; trigger-reply char=${charname}`)
	setTimeout(async () => {
		const tr = await chatApi('POST', `/groups/${gid}/channels/${cid}/trigger-reply`, { charname })
		console.log(`trigger-reply -> ${tr.status}`)
		if (tr.status !== 200) {
			clearTimeout(timeout)
			resolveDone(`trigger:${tr.status}`)
		}
	}, 750)
}
/**
 * @param {MessageEvent} ev WebSocket 消息事件
 * @returns {void}
 */
function onWsMessage(ev) {
	let wire
	try { wire = JSON.parse(ev.data) } catch { return }
	const type = wire.type
	received.push(type)

	if (type === 'stream_chunk' && (!wire.channelId || wire.channelId === cid)) {
		sawStreamChunk = true
		pendingStreamId = String(wire.pendingStreamId || pendingStreamId || '')
		console.log(`stream_chunk seq=${wire.chunkSeq} streamId=${pendingStreamId?.slice(0, 12)}…`)
		maybeResolve()
	}

	if (type === 'message_replaced') {
		const entry = wire.payload?.entry ?? wire.entry
		const ch = entry?.extension?.groupChannelId
		if (!ch || ch === cid) {
			sawFinish = true
			console.log(`message_replaced generating=${entry?.is_generating}`)
			maybeResolve()
		}
	}

	if (type === 'channel_message' && wire.channelId === cid) {
		const content = wire.payload?.content ?? wire.content
		if (content && !content.is_generating) {
			sawFinish = true
			console.log('channel_message (final)')
			maybeResolve()
		}
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

if (pendingStreamId) {
	const buf = await chatApi('GET', `/groups/${gid}/channels/${cid}/stream-buffer/${pendingStreamId}`)
	const chunks = buf.json?.chunks
	console.log(`stream-buffer ${pendingStreamId.slice(0, 12)}… -> ${buf.status} chunks=${Array.isArray(chunks) ? chunks.length : 'n/a'}`)
}

await chatApi('DELETE', `/groups/${gid}`)

console.log(`result=${result} stream=${sawStreamChunk} finish=${sawFinish} types=[${[...new Set(received)].join(', ')}]`)

if (result === 'ok') {
	const detail = sawStreamChunk
		? 'received stream_chunk' + (sawFinish ? ' + finish' : '')
		: 'received generation finish without stream_chunk'
	finish(true, detail)
}
if (String(result).startsWith('trigger:')) finish(false, result)
finish(false, result)
