/* global Deno */
import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createReassembler, decodeFrame, encodeFrames } from '../../link/frame.mjs'

Deno.test('encodeFrames and createReassembler round-trip a multi-frame payload', () => {
	const payload = new TextEncoder().encode('x'.repeat(40_000))
	const frames = encodeFrames('ab'.repeat(16), payload)
	assertEquals(frames.length > 1, true)
	const first = decodeFrame(frames[0])
	assertEquals(first.msgId, 'ab'.repeat(16))
	assertEquals(first.seq, 0)
	assertEquals(first.total, frames.length)
	const reassembler = createReassembler()
	let merged = null
	for (const frame of frames)
		merged = reassembler.push(frame)
	assertEquals(new TextDecoder().decode(merged), new TextDecoder().decode(payload))
})

Deno.test('reassembler clear drops partial state', () => {
	const payload = new TextEncoder().encode('y'.repeat(20_000))
	const frames = encodeFrames('cd'.repeat(16), payload)
	const reassembler = createReassembler({ partialTimeoutMs: 10 })
	assertEquals(reassembler.push(frames[0], 0), null)
	assertEquals(reassembler.size(), 1)
	reassembler.clear()
	assertEquals(reassembler.size(), 0)
})

Deno.test('reassembler rejects oversized messages', async () => {
	const payload = new TextEncoder().encode('z'.repeat(20_000))
	const frame = encodeFrames('ef'.repeat(16), payload)[0]
	const reassembler = createReassembler({ maxMessageBytes: 1024 })
	await assertRejects(async () => {
		reassembler.push(frame)
	})
})
