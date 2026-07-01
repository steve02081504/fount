/**
 * Ephemeral minimal NIP-01 Nostr relay for federation live tests.
 * Replaces public relay dependency with a local ws:// relay.
 */
import { createServer } from 'node:http'

import { WebSocketServer } from 'npm:ws'

import { pickAvailablePort } from '../node/launch.mjs'

/** @type {{ httpServer: import('node:http').Server, wss: WebSocketServer, relayUrl: string } | null} */
let activeRelay = null
/** 引用计数：多个并发 fed 套件共享同一 relay 实例，最后一个 stop 才真正关闭。 */
let relayRefCount = 0

/** @type {object[]} */
let storedEvents = []

/**
 * @param {object} event Nostr event
 * @param {object} filter REQ filter
 * @returns {boolean} 是否匹配
 */
function eventMatchesFilter(event, filter) {
	if (!filter || typeof filter !== 'object') return true
	if (Array.isArray(filter.ids) && filter.ids.length && !filter.ids.includes(event.id)) return false
	if (Array.isArray(filter.authors) && filter.authors.length && !filter.authors.includes(event.pubkey)) return false
	if (Array.isArray(filter.kinds) && filter.kinds.length && !filter.kinds.includes(event.kind)) return false
	if (filter.since != null && Number(event.created_at) < Number(filter.since)) return false
	if (Array.isArray(filter['#p']) && filter['#p'].length) {
		const tags = Array.isArray(event.tags) ? event.tags : []
		const pTags = tags.filter(tag => tag[0] === 'p').map(tag => tag[1])
		if (!filter['#p'].some(p => pTags.includes(p))) return false
	}
	if (Array.isArray(filter['#x']) && filter['#x'].length) {
		const tags = Array.isArray(event.tags) ? event.tags : []
		const xTags = tags.filter(tag => tag[0] === 'x').map(tag => tag[1])
		if (!filter['#x'].some(x => xTags.includes(x))) return false
	}
	return true
}

/**
 * @param {import('npm:ws').WebSocket} ws 客户端
 * @param {string} subId 订阅 id（NIP-01 EVENT 第二字段）
 * @param {object} event Nostr event
 * @returns {void}
 */
function broadcastEvent(ws, subId, event) {
	if (ws.readyState !== ws.OPEN) return
	ws.send(JSON.stringify(['EVENT', subId, event]))
}

/**
 * @param {object} event Nostr event
 * @returns {void}
 */
function relayEvent(event) {
	storedEvents.push(event)
	if (storedEvents.length > 5000) storedEvents = storedEvents.slice(-2500)
	if (process.env.FOUNT_TEST === '1') {
		const xTag = event.tags?.find(t => t[0] === 'x')?.[1]
		console.warn('test-relay: ingest EVENT', { kind: event.kind, xTag, clients: activeRelay?.wss?.clients?.size ?? 0 })
	}
	for (const client of activeRelay?.wss?.clients || [])
		for (const sub of client.subscriptions || [])
			if (sub.filters.some(filter => eventMatchesFilter(event, filter))) {
				if (process.env.FOUNT_TEST === '1')
					console.warn('test-relay: forward EVENT', { subId: sub.id, kind: event.kind })
				broadcastEvent(client, sub.id, event)
			}
}

/**
 * @param {import('npm:ws').WebSocket & { subscriptions?: Array<{ id: string, filters: object[] }> }} ws 客户端
 * @param {string | Buffer | ArrayBuffer} raw 入站帧
 * @returns {void}
 */
function handleClientMessage(ws, raw) {
	let message
	try {
		message = JSON.parse(String(raw))
	}
	catch {
		return
	}
	if (!Array.isArray(message) || !message.length) return
	const [type, ...rest] = message
	if (type === 'EVENT') {
		const event = rest[0]
		if (event && typeof event === 'object') {
			relayEvent(event)
			if (ws.readyState === ws.OPEN)
				ws.send(JSON.stringify(['OK', event.id || '', true, '']))
		}
		return
	}
	if (type === 'REQ') {
		const subId = String(rest[0] || '')
		const filters = rest.slice(1).filter(item => item && typeof item === 'object')
		if (process.env.FOUNT_TEST === '1')
			console.warn('test-relay: REQ', { subId, filterCount: filters.length, kinds: filters.flatMap(f => f.kinds || []) })
		if (!ws.subscriptions) ws.subscriptions = []
		ws.subscriptions.push({ id: subId, filters: filters.length ? filters : [{}] })
		for (const event of storedEvents)
			if (filters.some(filter => eventMatchesFilter(event, filter)))
				broadcastEvent(ws, subId, event)
		ws.send(JSON.stringify(['EOSE', subId]))
		return
	}
	if (type === 'CLOSE') {
		const subId = String(rest[0] || '')
		ws.subscriptions = (ws.subscriptions || []).filter(sub => sub.id !== subId)
	}
}

/**
 * 启动（或复用）本地 Nostr relay。
 * 引用计数递增；多个并发 fed 套件调用时返回同一个 URL。
 * @returns {Promise<{ relayUrl: string, port: number }>} relay 连接 URL 与端口
 */
export async function startTestNostrRelay() {
	relayRefCount++
	if (activeRelay)
		return { relayUrl: activeRelay.relayUrl, port: Number(new URL(activeRelay.relayUrl).port) }

	const port = await pickAvailablePort(18_883)
	const httpServer = createServer()
	const wss = new WebSocketServer({ server: httpServer })

	wss.on('connection', ws => {
		/** @type {import('npm:ws').WebSocket & { subscriptions?: Array<{ id: string, filters: object[] }> }} */
		const client = ws
		client.subscriptions = []
		client.on('message', raw => handleClientMessage(client, raw))
		client.on('close', () => { client.subscriptions = [] })
	})

	await new Promise((resolve, reject) => {
		httpServer.once('error', reject)
		httpServer.listen(port, '127.0.0.1', resolve)
	})

	const relayUrl = `ws://127.0.0.1:${port}`
	activeRelay = { httpServer, wss, relayUrl }
	storedEvents = []
	return { relayUrl, port }
}

/**
 * 释放本 suite 对 relay 的引用；引用归零时才真正关闭。
 * @returns {Promise<void>}
 */
export async function stopTestNostrRelay() {
	relayRefCount = Math.max(0, relayRefCount - 1)
	if (relayRefCount > 0 || !activeRelay) return
	const { httpServer, wss } = activeRelay
	activeRelay = null
	storedEvents = []
	await new Promise(resolve => {
		for (const client of wss.clients)
			client.close()
		wss.close(() => resolve())
	})
	await new Promise(resolve => { httpServer.close(() => resolve()) })
}
