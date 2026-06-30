// AV relay WebSocket: two clients in same room, 26-byte header + payload relay (avRelay.mjs)
import { liveWsBaseUrl, requireLiveApiKey, requireLiveBaseUrl } from 'fount/scripts/test/live/env.mjs'

const BASE = requireLiveBaseUrl()
const KEY = requireLiveApiKey()
const HEADER_SIZE = 26
const TIMEOUT_MS = 20_000

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

/**
 * 以通过/失败状态结束进程。
 * @param {boolean} ok 是否通过
 * @param {string} detail 结果说明
 * @returns {never} 以 0/1 退出
 */
function finish(ok, detail) {
	console.log(`\n${ok ? 'PASS' : 'FAIL'}: ${detail}`)
	process.exit(ok ? 0 : 1)
}

/**
 * 构造 AV relay 二进制帧（26 字节头 + 载荷）。
 * @param {Uint8Array|ArrayBuffer} payload 帧载荷
 * @param {object} [opts={}] frameType / seq 等
 * @returns {ArrayBuffer} 26 字节头 + payload
 */
function buildAvFrame(payload, opts = {}) {
	const buf = new Uint8Array(HEADER_SIZE + payload.length)
	buf[0] = opts.frameType ?? 1
	buf[1] = 0
	const view = new DataView(buf.buffer)
	view.setUint32(2, opts.seq ?? 1, false)
	view.setUint32(6, 0, false)
	crypto.getRandomValues(buf.subarray(10, 26))
	buf.set(payload, HEADER_SIZE)
	return buf.buffer
}

/**
 * 连接 AV relay WebSocket 并等待 open。
 * @param {string} roomId AV relay 房间 ID
 * @returns {Promise<WebSocket>} 已 open 的 WebSocket
 */
function connectAv(roomId) {
	const url = `${liveWsBaseUrl()}/ws/parts/shells:chat/av-relay/${encodeURIComponent(roomId)}?fount-apikey=${KEY}`
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url)
		const timer = setTimeout(() => {
			try { ws.close() } catch { /* ignore */ }
			reject(new Error('connect timeout'))
		}, TIMEOUT_MS)
		/** AV socket 连接成功回调。 */
		ws.onopen = () => {
			clearTimeout(timer)
			resolve(ws)
		}
		/** AV socket 连接失败回调。 */
		ws.onerror = () => {
			clearTimeout(timer)
			reject(new Error('ws error'))
		}
	})
}

/**
 * 等待 AV relay peer_count 达到 2。
 * @param {WebSocket} ws 已连接的 AV socket
 * @returns {Promise<number>} peer_count 达到 2 时 resolve
 */
function waitPeerCount(ws) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('peer_count timeout')), TIMEOUT_MS)
		/**
		 * 处理 peer_count 广播消息。
		 * @param {MessageEvent} ev WebSocket 消息事件
		 * @returns {void}
		 */
		function onMessage(ev) {
			if (typeof ev.data !== 'string') return
			let msg
			try { msg = JSON.parse(ev.data) } catch { return }
			if (msg?.type !== 'peer_count') return
			console.log(`peer_count=${msg.count}`)
			if (msg.count >= 2) {
				clearTimeout(timer)
				resolve(msg.count)
			}
		}
		ws.onmessage = onMessage
	})
}

/**
 * 等待接收端收到匹配的二进制 relay 帧。
 * @param {WebSocket} ws 接收端 socket
 * @param {Uint8Array} expectPayload 期望载荷
 * @returns {Promise<void>} 收到匹配二进制帧后 resolve
 */
function waitBinaryPayload(ws, expectPayload) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('relay timeout')), TIMEOUT_MS)
		/**
		 * 校验 relay 二进制帧载荷。
		 * @param {MessageEvent} ev WebSocket 二进制消息事件
		 * @returns {Promise<void>}
		 */
		async function onMessage(ev) {
			let raw = ev.data
			if (raw instanceof Blob)
				raw = await raw.arrayBuffer()
			const data = raw instanceof ArrayBuffer
				? new Uint8Array(raw)
				: new Uint8Array(raw)
			if (data.length < HEADER_SIZE + expectPayload.length) return
			const got = data.subarray(HEADER_SIZE, HEADER_SIZE + expectPayload.length)
			for (let i = 0; i < expectPayload.length; i++)
				if (got[i] !== expectPayload[i]) return
			clearTimeout(timer)
			resolve()
		}
		ws.onmessage = onMessage
	})
}

const who = await rootApi('GET', '/api/whoami')
if (who.status !== 200) finish(false, `server unreachable (whoami ${who.status})`)

const g = await chatApi('POST', '/groups/', { name: 'AvRelayTest' })
if (!okStatus(g.status) || !g.json?.groupId) finish(false, `create group failed (${g.status})`)

const gid = g.json.groupId
const cid = g.json.defaultChannelId
const roomId = `${gid}:${cid}`
console.log(`roomId=${roomId}`)

let wsA
let wsB
try {
	wsA = await connectAv(roomId)
	wsB = await connectAv(roomId)
	console.log('both AV sockets open')
	await Promise.all([waitPeerCount(wsA), waitPeerCount(wsB)])

	const payload = new TextEncoder().encode('av-relay-e2e-payload')
	const relayPromise = waitBinaryPayload(wsB, payload)
	wsA.send(buildAvFrame(payload, { frameType: 1, seq: 42 }))
	await relayPromise
	console.log('peer received matching binary frame')

	try { wsA.close() } catch { /* ignore */ }
	try { wsB.close() } catch { /* ignore */ }
	await chatApi('DELETE', `/groups/${gid}`)
	finish(true, '26-byte header frame relayed to peer')
}
catch (error) {
	try { wsA?.close() } catch { /* ignore */ }
	try { wsB?.close() } catch { /* ignore */ }
	await chatApi('DELETE', `/groups/${gid}`)
	finish(false, String(error?.message || error))
}
