/**
 * 非成员 /emoji-content：contentHash 提示 + 全局 CAS 就近解析。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { putChunk } from 'npm:@steve02081504/fount-p2p/files/chunk_store'
import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { computeEmojiContentHash } from '../../src/group/groupEmojis.mjs'
import { createIntegrationBoot } from '../harness.mjs'

const { ensureServer, username } = createIntegrationBoot({
	username: 'emoji-resolve-user',
	tempDirPrefix: 'fount_emoji_resolve_',
	minP2pNode: true,
})

const GROUP_ID = 'grp-emoji-resolve-nm'
const EMOJI_ID = 'e-nm-probe'
const PNG = Buffer.from([
	0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
	0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
	0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
	0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
	0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
	0x42, 0x60, 0x82,
])

Deno.test('resolveGroupEmojiContent fetches via contentHash hint without local manifest', async () => {
	await ensureServer()
	const { resolveGroupEmojiContent } = await import('../../src/group/emojiContentResolve.mjs')
	const contentHash = computeEmojiContentHash(PNG)
	await putChunk(contentHash, PNG)

	const resolved = await resolveGroupEmojiContent(username, GROUP_ID, EMOJI_ID, { contentHash })
	assertExists(resolved)
	assertEquals(resolved.mimeType, 'image/png')
	assertEquals(Buffer.compare(resolved.buffer, PNG), 0)
	assertEquals(resolved.entry.contentHash, contentHash)
})

Deno.test('resolveGroupEmojiContent ignores invalid contentHash hint', async () => {
	await ensureServer()
	const { resolveGroupEmojiContent } = await import('../../src/group/emojiContentResolve.mjs')
	const resolved = await resolveGroupEmojiContent(username, GROUP_ID, 'missing-emoji', {
		contentHash: 'not-a-valid-hash',
	})
	assertEquals(resolved, null)
})
