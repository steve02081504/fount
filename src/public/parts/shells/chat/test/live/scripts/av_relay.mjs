// AV relay WebSocket: two clients in same room, 26-byte header + payload relay (avRelay.mjs)
import { ms } from 'fount/scripts/ms.mjs'
import { liveWsBaseUrl } from 'fount/scripts/test/live/env.mjs'
import { createLiveShellHttp, finishLiveWs } from 'fount/scripts/test/live/wsHarness.mjs'

const { chatApi, rootApi, okStatus, key } = createLiveShellHttp()
const HEADER_SIZE = 26
const TIMEOUT_MS = ms('20s')

/**
 * 构造 AV relay 二进制帧（26 字节头 + 载荷）。
 * @param {Uint8Array|ArrayBuffer} payload 帧载荷
 * @param {object} [options={}] frameType / seq 等
 * @returns {ArrayBuffer} 26 字节头 + payload
 */
function buildAvFrame(payload, options = {}) {
	const buf = new Uint8Array(HEADER_SIZE + payload.length)
	buf[0] = options.frameType ?? 1
	buf[1] = 0
	const view = new DataView(buf.buffer)
	view.setUint32(2, options.seq ?? 1, false)
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
	const url = `${liveWsBaseUrl()}/ws/parts/shells:chat/av-relay/${encodeURIComponent(roomId)}?fount-apikey=${key}`
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
			let wireMessage
			try { wireMessage = JSON.parse(ev.data) } catch { return }
			if (wireMessage?.type !== 'peer_count') return
			console.log(`peer_count=${wireMessage.count}`)
			if (wireMessage.count >= 2) {
				clearTimeout(timer)
				resolve(wireMessage.count)
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
if (who.status !== 200) finishLiveWs(false, `server unreachable (whoami ${who.status})`)

const g = await chatApi('POST', '/groups/', { name: 'AvRelayTest' })
if (!okStatus(g.status) || !g.json?.groupId) finishLiveWs(false, `create group failed (${g.status})`)

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
	finishLiveWs(true, '26-byte header frame relayed to peer')
}
catch (error) {
	try { wsA?.close() } catch { /* ignore */ }
	try { wsB?.close() } catch { /* ignore */ }
	await chatApi('DELETE', `/groups/${gid}`)
	finishLiveWs(false, String(error?.message || error))
}
