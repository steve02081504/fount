/**
 * 非成员 emoji 内容访问单元测试。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { Buffer } from 'node:buffer'

import { computeEmojiContentHash } from '../src/group/groupEmojis.mjs'

Deno.test('emoji content hash for non-member reuse path', () => {
	const hash = computeEmojiContentHash(Buffer.from([1, 2, 3]))
	assertEquals(typeof hash, 'string')
	assertEquals(hash.length, 64)
})
