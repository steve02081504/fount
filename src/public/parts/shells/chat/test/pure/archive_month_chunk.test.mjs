/* global Deno */
import { Buffer } from 'node:buffer'


import { FEDERATION_CHUNK_MAX_BYTES } from 'npm:@steve02081504/fount-p2p/core/constants'
import { encryptPlaintextToMultiParts } from 'npm:@steve02081504/fount-p2p/files/assemble'
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { wirePartsFromEncParts } from '../../src/chat/archive/monthChunks.mjs'
import { digestArchiveMonthBody } from '../../src/chat/archive/monthDigest.mjs'
import { parseFedArchiveMonthResponse } from '../../src/chat/federation/archiveMonthWire.mjs'

/**
 * 按分片顺序重组归档月明文。
 * @param {Array<{ hash: string, index: number }>} parts wire parts
 * @param {Record<string, Uint8Array | Buffer>} fetched hash → bytes
 * @returns {string} 重组 JSONL 明文
 */
function assembleArchiveMonthBodyFromParts(parts, fetched) {
	const sorted = [...parts].sort((a, b) => a.index - b.index)
	return Buffer.concat(sorted.map(part => Buffer.from(fetched[part.hash] || []))).toString('utf8')
}

const A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

Deno.test('wirePartsFromEncParts assigns sequential index', () => {
	const wired = wirePartsFromEncParts([
		{ hash: 'b'.repeat(64), size: 10 },
		{ hash: 'c'.repeat(64), size: 20 },
	])
	assertEquals(wired[0].index, 0)
	assertEquals(wired[1].index, 1)
})

Deno.test('assembleArchiveMonthBodyFromParts roundtrip', () => {
	const line = JSON.stringify({
		eventId: A,
		channelId: 'general',
		timestamp: 1,
		content: { type: 'text', content: 'hello' },
	})
	const body = `${line}\n`
	const enc = encryptPlaintextToMultiParts(Buffer.from(body, 'utf8'), 'plain')
	const parts = wirePartsFromEncParts(enc.parts)
	/** 已拉取的分片原始字节映射。
	 * @type {Record<string, Uint8Array>} */
	const fetched = {}
	for (const part of enc.parts) fetched[part.hash] = part.raw
	const restored = assembleArchiveMonthBodyFromParts(parts, fetched)
	assertEquals(restored, body)
	assertEquals(digestArchiveMonthBody(restored).digest, digestArchiveMonthBody(body).digest)
})

Deno.test('multi-chunk split for large archive month body', () => {
	const bigLine = JSON.stringify({
		eventId: A,
		channelId: 'general',
		content: { type: 'text', content: 'x'.repeat(FEDERATION_CHUNK_MAX_BYTES) },
	})
	const enc = encryptPlaintextToMultiParts(Buffer.from(`${bigLine}\n`, 'utf8'), 'plain')
	assertEquals(enc.parts.length > 1, true)
})

Deno.test('parseFedArchiveMonthResponse rejects missing complete flag', () => {
	const digest = 'd'.repeat(64)
	assertEquals(parseFedArchiveMonthResponse({
		requestId: 'r1',
		channelId: 'general',
		utcMonth: '2024-01',
		digest,
		parts: [{ hash: 'e'.repeat(64), size: 1, index: 0 }],
	}), null)
})

Deno.test('parseFedArchiveMonthResponse rejects inline body field', () => {
	const digest = 'd'.repeat(64)
	assertEquals(parseFedArchiveMonthResponse({
		requestId: 'r1',
		channelId: 'general',
		utcMonth: '2024-01',
		complete: true,
		digest,
		parts: [{ hash: 'e'.repeat(64), size: 1, index: 0 }],
		body: 'inline',
	}), null)
})

Deno.test('parseFedArchiveMonthResponse accepts chunk meta', () => {
	const digest = 'd'.repeat(64)
	const parsed = parseFedArchiveMonthResponse({
		requestId: 'r1',
		channelId: 'general',
		utcMonth: '2024-01',
		complete: true,
		digest,
		parts: [{ hash: 'e'.repeat(64), size: 1, index: 0 }],
	})
	assertEquals(parsed?.digest, digest)
	assertEquals(parsed?.parts?.length, 1)
})
