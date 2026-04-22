import { Buffer } from 'node:buffer'

/** 约 4MB 服务端日志环形缓冲（JSON 字节计） */
const MAX_BYTES = 4 * 1024 * 1024

/** @type {any[]} */
const ring = []
/** @type {number} */
let seq = 0
/** @type {number} */
let bytesEstimate = 0

import { WebSocket } from 'npm:ws'

/** @type {Set<import('npm:ws').WebSocket>} */
const subscribers = new Set()

/**
 * @param {unknown} row
 */
function measureRow(row) {
	try {
		return Buffer.byteLength(JSON.stringify(row), 'utf8')
	}
	catch {
		return 4096
	}
}

/**
 * @param {object} entry
 */
export function appendServerConsoleEntry(entry) {
	seq++
	const row = Object.assign({ seq, t: Date.now() }, entry)
	ring.push(row)
	bytesEstimate += measureRow(row)
	while (bytesEstimate > MAX_BYTES && ring.length > 1) {
		const rm = ring.shift()
		bytesEstimate -= measureRow(rm)
	}
	const payload = JSON.stringify({ type: 'log', entry: row })
	for (const ws of subscribers) {
		if (ws.readyState !== WebSocket.OPEN) continue
		try {
			ws.send(payload)
		}
		catch {
			subscribers.delete(ws)
		}
	}
}

/**
 * @param {number} [sinceSeq]
 */
export function getServerLogSnapshot(sinceSeq = 0) {
	return ring.filter(r => r.seq > sinceSeq)
}

export function getServerLogSeqMax() {
	return seq
}

/**
 * @param {import('npm:ws').WebSocket} ws
 */
export function subscribeServerLogs(ws) {
	subscribers.add(ws)
	ws.send(JSON.stringify({
		type: 'snapshot',
		entries: ring,
		seqMax: seq,
	}))
	ws.on('close', () => {
		subscribers.delete(ws)
	})
}

/**
 * @param {{ options: object }} defaultConsole
 */
export function chainServerLogRing(defaultConsole) {
	const prev = defaultConsole.options.onLogEntry
	defaultConsole.options.onLogEntry = entry => {
		prev?.(entry)
		appendServerConsoleEntry(entry)
	}
}
