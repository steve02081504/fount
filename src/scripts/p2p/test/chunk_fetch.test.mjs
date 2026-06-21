/* global Deno */
import { createHash } from 'node:crypto'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { u8ToB64 } from '../bytes_codec.mjs'
import {
	chunkBytesMatchHash,
	pendingChunkFetches,
	resolvePendingChunkFetch,
	verifiedChunkBytes,
} from '../files/chunk_fetch.mjs'

const GOOD_BYTES = new TextEncoder().encode('chunk-payload')
const HASH = createHash('sha256').update(GOOD_BYTES).digest('hex')
const BAD_BYTES = new TextEncoder().encode('wrong-payload')

/**
 * @param {string} requestId 请求 id
 * @param {Uint8Array} bytes 响应字节
 * @returns {Uint8Array | null | undefined} 解析结果
 */
function resolveChunkFetchTest(requestId, bytes) {
	/** @type {Uint8Array | null | undefined} */
	let resolved
	/**
	 * @param {Uint8Array | null} data 块数据
	 */
	function captureChunk(data) {
		resolved = data
	}
	pendingChunkFetches.set(requestId, {
		expectedHash: HASH,
		resolve: captureChunk,
	})
	resolvePendingChunkFetch({ requestId, dataB64: u8ToB64(bytes) })
	pendingChunkFetches.delete(requestId)
	return resolved
}

Deno.test('chunkBytesMatchHash accepts matching digest', () => {
	assertEquals(chunkBytesMatchHash(HASH, GOOD_BYTES), true)
	assertEquals(verifiedChunkBytes(HASH, GOOD_BYTES)?.byteLength, GOOD_BYTES.byteLength)
})

Deno.test('chunkBytesMatchHash rejects mismatched digest', () => {
	assertEquals(chunkBytesMatchHash(HASH, BAD_BYTES), false)
	assertEquals(verifiedChunkBytes(HASH, BAD_BYTES), null)
})

Deno.test('resolvePendingChunkFetch rejects hash mismatch', () => {
	assertEquals(resolveChunkFetchTest('req-mismatch', BAD_BYTES), null)
})

Deno.test('resolvePendingChunkFetch accepts matching hash', () => {
	assertEquals(resolveChunkFetchTest('req-match', GOOD_BYTES)?.byteLength, GOOD_BYTES.byteLength)
})
