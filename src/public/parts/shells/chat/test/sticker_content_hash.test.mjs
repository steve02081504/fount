/**
 * 贴纸 contentHash 单测。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { computeStickerContentHash } from '../src/stickers/stickers.mjs'

Deno.test('computeStickerContentHash is stable sha256 hex', () => {
	const hash = computeStickerContentHash(Buffer.from('sticker-payload'))
	assertEquals(hash.length, 64)
	assertEquals(computeStickerContentHash(Buffer.from('sticker-payload')), hash)
})
