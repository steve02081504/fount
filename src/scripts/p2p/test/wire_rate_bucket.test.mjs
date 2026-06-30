/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { consumeWireRateBucket } from '../wire_rate_bucket.mjs'

Deno.test('consumeWireRateBucket allows first consumption', () => {
	const key = `bucket-first-${crypto.randomUUID()}`
	assertEquals(consumeWireRateBucket(key, { maxCount: 5 }), true)
})

Deno.test('consumeWireRateBucket rejects when count budget exhausted', () => {
	const key = `bucket-count-${crypto.randomUUID()}`
	const limits = { maxCount: 2 }
	assertEquals(consumeWireRateBucket(key, limits), true)
	assertEquals(consumeWireRateBucket(key, limits), true)
	assertEquals(consumeWireRateBucket(key, limits), false)
})

Deno.test('consumeWireRateBucket refills tokens after window elapses', () => {
	const key = `bucket-refill-${crypto.randomUUID()}`
	const limits = { maxCount: 1 }
	let now = 5_000_000
	const originalNow = Date.now
	/** @returns {number} 模拟时间戳 */
	function mockDateNow() {
		return now
	}
	Date.now = mockDateNow
	try {
		assertEquals(consumeWireRateBucket(key, limits), true)
		assertEquals(consumeWireRateBucket(key, limits), false)
		now += 60_001
		assertEquals(consumeWireRateBucket(key, limits), true)
	}
	finally {
		Date.now = originalNow
	}
})

Deno.test('consumeWireRateBucket enforces byte budget when configured', () => {
	const key = `bucket-bytes-${crypto.randomUUID()}`
	const limits = { maxCount: 10, maxBytesPerWindow: 1000, byteCount: 600 }
	assertEquals(consumeWireRateBucket(key, limits), true)
	assertEquals(consumeWireRateBucket(key, limits), false)
})
