/**
 * 贴纸 contentHash 单测。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assertEquals } from 'jsr:@std/assert'

import { computeStickerContentHash } from '../../src/stickers/stickers.mjs'

Deno.test('computeStickerContentHash is stable sha256 hex', () => {
	const hash = computeStickerContentHash(Buffer.from('sticker-payload'))
	assertEquals(hash.length, 64)
	assertEquals(computeStickerContentHash(Buffer.from('sticker-payload')), hash)
})
