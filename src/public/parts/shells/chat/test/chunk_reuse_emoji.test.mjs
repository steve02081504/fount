/**
 * Emoji CAS contentHash 单测（哈希稳定；CAS 读写见 fed_emoji_nearcache live）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { Buffer } from 'node:buffer'

import { computeEmojiContentHash } from '../src/group/groupEmojis.mjs'

Deno.test('computeEmojiContentHash is deterministic for CAS keys', () => {
	const a = computeEmojiContentHash(Buffer.from('near-cache-payload'))
	const b = computeEmojiContentHash(Buffer.from('near-cache-payload'))
	assertEquals(a, b)
	assertEquals(a.length, 64)
})

Deno.test('computeEmojiContentHash differs for different payloads', () => {
	const a = computeEmojiContentHash(Buffer.from('payload-a'))
	const b = computeEmojiContentHash(Buffer.from('payload-b'))
	assertEquals(a === b, false)
})
