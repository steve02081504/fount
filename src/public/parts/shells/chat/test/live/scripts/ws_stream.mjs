// Group WebSocket stream: trigger-reply → stream_chunk and/or message_replaced finish
import { ms } from 'fount/scripts/ms.mjs'
import { liveWsBaseUrl } from 'fount/scripts/test/live/env.mjs'
import {
	createLiveShellHttp,
	failLiveWsPrecondition,
	finishLiveWs,
	pickPreferredChar,
} from 'fount/scripts/test/live/wsHarness.mjs'

const { chatApi, rootApi, okStatus, key } = createLiveShellHttp()
const PREFERRED_CHARS = ['test_streamer', 'TestStreamer']
const TIMEOUT_MS = ms('2m')

const who = await rootApi('GET', '/api/whoami')
if (who.status !== 200) finishLiveWs(false, `server unreachable (whoami ${who.status})`)

const charname = pickPreferredChar((await rootApi('GET', '/api/getlist/chars')).json, PREFERRED_CHARS)
if (!charname) failLiveWsPrecondition('no chars in getlist/chars (test_streamer fixture missing?)')

const g = await chatApi('POST', '/groups/', { name: 'WSStreamTest' })
if (!okStatus(g.status) || !g.json?.groupId) finishLiveWs(false, `create group failed (${g.status})`)

const gid = g.json.groupId
const cid = g.json.defaultChannelId
const add = await chatApi('POST', `/groups/${gid}/char`, { charname, deferGreeting: true })
if (!okStatus(add.status)) {
	await chatApi('DELETE', `/groups/${gid}`)
	failLiveWsPrecondition(`cannot add char ${charname} (${add.status})`)
}

const postResponse = await chatApi('POST', `/groups/${gid}/channels/${cid}/messages`, {
	content: { type: 'text', content: 'ws-stream probe', isAutoTrigger: true },
})
if (!okStatus(postResponse.status)) {
	await chatApi('DELETE', `/groups/${gid}`)
	finishLiveWs(false, `post message failed (${postResponse.status})`)
}

const peers = await chatApi('GET', `/groups/${gid}/peers`)
const nodeHash = peers.json?.selfNodeHash
if (!nodeHash) {
	await chatApi('DELETE', `/groups/${gid}`)
	finishLiveWs(false, 'missing selfNodeHash')
}

const wsUrl = `${liveWsBaseUrl()}/ws/parts/shells:chat/groups/${nodeHash}/${gid}?fount-apikey=${key}`
const ws = new WebSocket(wsUrl)

const received = []
let pendingStreamId = null
let sawStreamChunk = false
let sawFinish = false
/** @type {Promise<string | void> | null} */
let triggerReplyTask = null
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
 * WebSocket 连接建立后触发角色流式回复。
 */
ws.onopen = () => {
	console.log(`WS open; trigger-reply char=${charname}`)
	triggerReplyTask = (async () => {
		await new Promise(r => { setTimeout(r, 750) })
		const tr = await chatApi('POST', `/groups/${gid}/channels/${cid}/trigger-reply`, { charname })
		console.log(`trigger-reply -> ${tr.status}`)
		if (tr.status !== 200) {
			clearTimeout(timeout)
			resolveDone(`trigger:${tr.status}`)
		}
	})()
}
/**
 * 处理 WebSocket 流式回复与完成事件。
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
 * WebSocket 错误时结束等待。
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

let dagFinalized = false
if (result === 'ok' && sawStreamChunk) {
	dagFinalized = await (async () => {
		for (let i = 0; i < 20; i++) {
			await new Promise(r => { setTimeout(r, 500) })
			const listResponse = await chatApi('GET', `/groups/${gid}/channels/${cid}/messages`)
			if (listResponse.status !== 200) continue
			const charRow = (listResponse.json?.messages || []).find(row => row.charId && !row.content?.is_generating)
			if (charRow) return true
		}
		return false
	})()
	console.log(`dagFinalized=${dagFinalized}`)
}

if (triggerReplyTask) await triggerReplyTask.catch(() => {})
await chatApi('DELETE', `/groups/${gid}`)

console.log(`result=${result} stream=${sawStreamChunk} finish=${sawFinish} types=[${[...new Set(received)].join(', ')}]`)

if (result === 'ok' && sawStreamChunk && dagFinalized) {
	const detail = 'received stream_chunk' + (sawFinish ? ' + finish' : '') + ' + dag finalized'
	finishLiveWs(true, detail)
}
if (result === 'ok' && sawStreamChunk && !dagFinalized)
	finishLiveWs(false, 'stream_chunk ok but DAG message still generating')
if (result === 'ok' && sawFinish)
	finishLiveWs(false, 'received generation finish without stream_chunk (stream test requires stream_chunk)')
if (String(result).startsWith('trigger:')) finishLiveWs(false, result)
finishLiveWs(false, result)
