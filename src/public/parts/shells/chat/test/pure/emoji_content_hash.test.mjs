/**
 * 群预览与 emoji contentHash 单元测试。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { scanEmojiTokens } from '../../../social/src/lib/emojiPostEmbed.mjs'
import { computeEmojiContentHash } from '../../src/group/groupEmojis.mjs'

Deno.test('computeEmojiContentHash is stable sha256 hex', () => {
	const hash = computeEmojiContentHash(Buffer.from('test'))
	assertEquals(hash.length, 64)
	assertEquals(computeEmojiContentHash(Buffer.from('test')), hash)
})

Deno.test('scanEmojiTokens finds group emoji markers', () => {
	const refs = scanEmojiTokens('hello :[g1/e1]: world :[g2/e2]:')
	assertEquals(refs.length, 2)
	assertEquals(refs[0], { groupId: 'g1', emojiId: 'e1' })
})
