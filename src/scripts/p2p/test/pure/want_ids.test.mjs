/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	batchWantIds,
	isWantIdsInBackoff,
	recordWantIdsBackoff,
	resolveWantIdsLimits,
	takeIncomingWantIdsSlot,
	takeOutgoingWantIdsSlot,
	wantIdsPeerKey,
} from '../../want_ids.mjs'

Deno.test('resolveWantIdsLimits applies defaults and clamps bounds', () => {
	const defaults = resolveWantIdsLimits()
	assertEquals(defaults.inWindowMs, 60_000)
	assertEquals(defaults.inMaxBatch, 32)
	assertEquals(defaults.outWindowMs, 60_000)
	assertEquals(defaults.outMaxBatch, 16)

	const clamped = resolveWantIdsLimits({
		inWindowMs: 100,
		inMaxBatch: -5,
		outWindowMs: 50_000,
		outMaxBatch: 999,
	})
	assertEquals(clamped.inWindowMs, 1000)
	assertEquals(clamped.inMaxBatch, 1)
	assertEquals(clamped.outWindowMs, 50_000)
	assertEquals(clamped.outMaxBatch, 256)
})

Deno.test('wantIdsPeerKey joins group and peer with null separator', () => {
	const key = wantIdsPeerKey('group-a', 'peer-b')
	assertEquals(key, 'group-a\0peer-b')
})

Deno.test('takeIncomingWantIdsSlot enforces per-peer batch limit and backoff', () => {
	const groupId = `in-${crypto.randomUUID()}`
	const peerId = `peer-${crypto.randomUUID()}`
	const limits = { inMaxBatch: 2, inWindowMs: 60_000 }
	const peerKey = wantIdsPeerKey(groupId, peerId)

	assertEquals(takeIncomingWantIdsSlot(groupId, peerId, limits), true)
	assertEquals(takeIncomingWantIdsSlot(groupId, peerId, limits), true)
	assertEquals(takeIncomingWantIdsSlot(groupId, peerId, limits), false)
	assert(isWantIdsInBackoff(peerKey))
})

Deno.test('takeOutgoingWantIdsSlot enforces per-group batch limit and backoff', () => {
	const groupId = `out-${crypto.randomUUID()}`
	const limits = { outMaxBatch: 2, outWindowMs: 60_000 }

	assertEquals(takeOutgoingWantIdsSlot(groupId, limits), true)
	assertEquals(takeOutgoingWantIdsSlot(groupId, limits), true)
	assertEquals(takeOutgoingWantIdsSlot(groupId, limits), false)
	assert(isWantIdsInBackoff(groupId))
})

Deno.test('batchWantIds caps list to budget', () => {
	const ids = Array.from({ length: 40 }, (_, i) => `id-${i}`)
	assertEquals(batchWantIds(ids, 16).length, 16)
	assertEquals(batchWantIds(ids, 0), ids.slice(0, 16))
	assertEquals(batchWantIds(ids, 300), ids.slice(0, 256))
})

Deno.test('recordWantIdsBackoff grows delay up to 120s cap', () => {
	const key = `backoff-${crypto.randomUUID()}`
	let now = 1_000_000
	const originalNow = Date.now
	/** @returns {number} 模拟时间戳 */
	function mockDateNow() {
		return now
	}
	Date.now = mockDateNow
	try {
		recordWantIdsBackoff(key)
		assert(isWantIdsInBackoff(key))
		now += 2_000
		assertEquals(isWantIdsInBackoff(key), false)

		recordWantIdsBackoff(key)
		now += 4_000
		assertEquals(isWantIdsInBackoff(key), false)

		for (let i = 0; i < 8; i++) recordWantIdsBackoff(key)
		const untilAfterStrike = now + 120_000
		recordWantIdsBackoff(key)
		now = untilAfterStrike - 1
		assert(isWantIdsInBackoff(key))
		now = untilAfterStrike
		assertEquals(isWantIdsInBackoff(key), false)
	}
	finally {
		Date.now = originalNow
	}
})
