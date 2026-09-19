import assert from 'node:assert/strict'
import test from 'node:test'

import { REQUEST_TIMEOUT_MS, RequestTracker } from '../../src/request-tracker.mjs'

const noTimeout = () => 0

test('resolves a matching request and ignores unknown or duplicate responses', async () => {
	const tracker = new RequestTracker({ scheduleTimeout: noTimeout })
	const request = tracker.request('request-1', () => {})

	assert.equal(tracker.resolve('unknown', 'ignored'), false)
	assert.equal(tracker.resolve('request-1', { ok: true }), true)
	assert.equal(tracker.resolve('request-1', { ok: false }), false)
	assert.deepEqual(await request, { ok: true })
})

test('rejects a matching request with the supplied error', async () => {
	const tracker = new RequestTracker({ scheduleTimeout: noTimeout })
	const expected = new Error('userscript failed')
	const request = tracker.request('request-1', () => {})

	assert.equal(tracker.reject('request-1', expected), true)
	await assert.rejects(request, error => error === expected)
})

test('times out with the existing 15 second contract and exact message', async () => {
	let timeoutCallback
	let timeoutMs
	const tracker = new RequestTracker({
		scheduleTimeout(callback, delay) {
			timeoutCallback = callback
			timeoutMs = delay
			return 0
		},
	})
	const request = tracker.request('request-1', () => {})

	assert.equal(REQUEST_TIMEOUT_MS, 15_000)
	assert.equal(timeoutMs, 15_000)
	timeoutCallback()

	await assert.rejects(
		request,
		{ name: 'Error', message: 'Request timed out after 15 seconds.' },
	)
	assert.equal(tracker.resolve('request-1', 'late'), false)
})

test('routes concurrent responses only by requestId', async () => {
	const tracker = new RequestTracker({ scheduleTimeout: noTimeout })
	const first = tracker.request('first', () => {})
	const second = tracker.request('second', () => {})

	tracker.resolve('second', 'second result')
	tracker.resolve('first', 'first result')

	assert.deepEqual(await Promise.all([first, second]), ['first result', 'second result'])
})

test('existing Promise handlers settle without an extra microtask bridge', async () => {
	const tracker = new RequestTracker({ scheduleTimeout: noTimeout })
	const order = []
	const request = new Promise((resolve, reject) => {
		tracker.requestWithResolvers('request-1', () => {}, resolve, reject)
	})
	request.then(() => order.push('settled'))

	tracker.resolve('request-1', 'result')
	queueMicrotask(() => order.push('marker'))
	await request
	await Promise.resolve()

	assert.deepEqual(order, ['settled', 'marker'])
})

test('a synchronous dispatch exception rejects unchanged and remains tracked until settled', async () => {
	const tracker = new RequestTracker({ scheduleTimeout: noTimeout })
	const expected = new TypeError('socket send failed')
	const request = new Promise((resolve, reject) => {
		tracker.requestWithResolvers('request-1', () => { throw expected }, resolve, reject)
	})

	await assert.rejects(request, error => error === expected)
	assert.equal(tracker.resolve('request-1', 'ignored after dispatch failure'), true)
	assert.equal(tracker.resolve('request-1', 'duplicate'), false)
})
