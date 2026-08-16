/**
 * Viewer 扇出：未认领 / 指名 job 不得混入别的 job 的 suite 事件。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { ViewerHub } from '../kernel/viewers.mjs'

/**
 * 可捕获 send 的假 WS。
 * @returns {{ ws: { readyState: number, send: (raw: string) => void }, events: object[] }} 句柄
 */
function captureWs() {
	/** @type {object[]} */
	const events = []
	return {
		ws: {
			readyState: 1,
			/**
			 * @param {string} raw 事件 JSON
			 * @returns {void}
			 */
			send: raw => { events.push(JSON.parse(raw)) },
		},
		events,
	}
}

const FOREIGN_START = { type: 'suite-start', key: 'checks:locale_md_align', jobId: 'job-a' }
const FOREIGN_END = { type: 'suite-end', key: 'checks:jsdoc_no_english', jobId: 'job-a', passed: true }

Deno.test('hello 前的 viewer 不接收其他 job 的 suite 事件', () => {
	const hub = new ViewerHub()
	const pending = captureWs()
	hub.add(pending.ws, { mode: 'overview' })
	hub.broadcast(FOREIGN_START)
	hub.broadcast(FOREIGN_END)
	assertEquals(pending.events, [])
})

Deno.test('overview job 不接收其他 fount test job 的 suite 事件', () => {
	const hub = new ViewerHub()
	const mine = captureWs()
	const viewer = hub.add(mine.ws, { mode: 'overview' })
	viewer.jobId = 'job-b'
	hub.broadcast(FOREIGN_START)
	hub.broadcast(FOREIGN_END)
	hub.broadcast({ type: 'suite-start', key: 'checks:text_lf', jobId: 'job-b' })
	assertEquals(mine.events.map(event => event.key), ['checks:text_lf'])
})

Deno.test('overview job 仍接收本 job 的 idle', () => {
	const hub = new ViewerHub()
	const mine = captureWs()
	const viewer = hub.add(mine.ws, { mode: 'overview' })
	viewer.jobId = 'job-b'
	hub.broadcast({ type: 'idle', remainingMs: 0, unknownCount: 0 })
	assertEquals(mine.events.map(event => event.type), ['idle'])
})

Deno.test('watch 仍接收全部 suite 事件', () => {
	const hub = new ViewerHub()
	const watch = captureWs()
	hub.add(watch.ws, { watch: true, mode: 'overview' })
	hub.broadcast(FOREIGN_START)
	assertEquals(watch.events.map(event => event.key), ['checks:locale_md_align'])
})
