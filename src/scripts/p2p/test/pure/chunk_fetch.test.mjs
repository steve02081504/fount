/* global Deno */
import { createHash } from 'node:crypto'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { ms } from '../../../ms.mjs'
import { u8ToB64 } from '../../bytes_codec.mjs'
import {
	chunkBytesMatchHash,
	verifiedChunkBytes,
} from '../../files/chunk_fetch_verify.mjs'
import {
	pendingChunkFetches,
	resolvePendingChunkFetch,
} from '../../chunk_fetch_pending.mjs'

const GOOD_BYTES = new TextEncoder().encode('chunk-payload')
const HASH = createHash('sha256').update(GOOD_BYTES).digest('hex')
const BAD_BYTES = new TextEncoder().encode('wrong-payload')

/**
 * 安装测试等待槽。
 * @param {string} requestId 请求 id
 * @returns {{ resolve: (data: Uint8Array | null) => void, resolved: () => Uint8Array | null | undefined }} 测试槽
 */
function installChunkFetchWaiter(requestId) {
	/**
	 * 保存已解析块。
	 * @type {Uint8Array | null | undefined}
	 */
	let resolved
	/**
	 * 记录解析结果。
	 * @param {Uint8Array | null} data 块数据
	 */
	function captureChunk(data) {
		resolved = data
	}
	const timer = setTimeout(() => pendingChunkFetches.delete(requestId), ms('1m'))
	pendingChunkFetches.set(requestId, {
		expectedHash: HASH,
		timer,
		resolve: captureChunk,
	})
	return {
		resolve: captureChunk,
		/**
		 * 读取当前解析值。
		 * @returns {Uint8Array | null | undefined} 已解析块
		 */
		resolved: () => resolved,
	}
}

Deno.test('chunkBytesMatchHash accepts matching digest', () => {
	assertEquals(chunkBytesMatchHash(HASH, GOOD_BYTES), true)
	assertEquals(verifiedChunkBytes(HASH, GOOD_BYTES)?.byteLength, GOOD_BYTES.byteLength)
})

Deno.test('chunkBytesMatchHash rejects mismatched digest', () => {
	assertEquals(chunkBytesMatchHash(HASH, BAD_BYTES), false)
	assertEquals(verifiedChunkBytes(HASH, BAD_BYTES), null)
})

Deno.test('resolvePendingChunkFetch ignores hash mismatch until valid response', () => {
	const requestId = 'req-mismatch-then-match'
	const waiter = installChunkFetchWaiter(requestId)
	resolvePendingChunkFetch({ requestId, dataB64: u8ToB64(BAD_BYTES) })
	assertEquals(waiter.resolved(), undefined)
	assertEquals(pendingChunkFetches.has(requestId), true)
	resolvePendingChunkFetch({ requestId, dataB64: u8ToB64(GOOD_BYTES) })
	assertEquals(waiter.resolved()?.byteLength, GOOD_BYTES.byteLength)
	assertEquals(pendingChunkFetches.has(requestId), false)
})

Deno.test('resolvePendingChunkFetch accepts matching hash', () => {
	const requestId = 'req-match'
	const waiter = installChunkFetchWaiter(requestId)
	resolvePendingChunkFetch({ requestId, dataB64: u8ToB64(GOOD_BYTES) })
	assertEquals(waiter.resolved()?.byteLength, GOOD_BYTES.byteLength)
})
