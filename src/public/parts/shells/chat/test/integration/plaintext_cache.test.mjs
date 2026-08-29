/**
 * 明文缓存路径（`files/{contentHash}.bin`）：hydration 惰性 buffer 应命中明文缓存，
 * 本地无密文（blob/chunk 均缺失）时也能读回字节，而不是回落到解密链路（解密失败 → 空 buffer → 空 data URL）。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assert, assertEquals } from 'jsr:@std/assert'

import { createIntegrationBoot } from '../harness.mjs'

const TINY_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64',
)

Deno.test('hydrateWireFiles getBuffer hits plaintext cache even without ciphertext', async () => {
	const username = `pc-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({ username, minP2pNode: true })
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { cachePlaintextFile } = await import('../../src/chat/files/blobStore.mjs')
	const { hydrateWireFiles } = await import('../../src/chat/dag/hydration.mjs')

	const groupId = await newGroup(username, { name: 'plain-cache-test' })
	const contentHash = 'a'.repeat(64)
	await cachePlaintextFile(username, contentHash, TINY_PNG)

	// 构造仅含 fileIndex 元数据的物化状态；无 blob / chunk / EVFS manifest（解密路径必然失败）
	const state = {
		messageOverlay: {
			fileIndex: new Map([
				['file-1', { contentHash, mime_type: 'image/png' }],
			]),
		},
	}
	const [descriptor] = hydrateWireFiles(username, groupId, state, [
		{ fileId: 'file-1', name: 'tiny.png', mime_type: 'image/png' },
	])
	assert(descriptor, 'descriptor expected')
	const bytes = await descriptor.getBuffer()
	assert(bytes?.length, 'getBuffer must resolve from plaintext cache')
	assertEquals(Buffer.from(bytes).equals(TINY_PNG), true)
})

Deno.test('cachePlaintextFile/getPlaintextCache round-trip via .bin suffix', async () => {
	const username = `pc-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({ username, minP2pNode: true })
	await ensureServer()

	const { cachePlaintextFile, getPlaintextCache } = await import('../../src/chat/files/blobStore.mjs')
	const contentHash = 'b'.repeat(64)
	await cachePlaintextFile(username, contentHash, TINY_PNG)
	const cached = await getPlaintextCache(username, contentHash)
	assert(cached?.length, 'plaintext cache readback expected')
	assertEquals(Buffer.from(cached).equals(TINY_PNG), true)
})