/**
 * Social emoji post embed 扫描测试。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { scanEmojiTokens } from '../src/lib/emojiPostEmbed.mjs'

Deno.test('scanEmojiTokens deduplicates repeated tokens', () => {
	const refs = scanEmojiTokens(':[a/b]: :[a/b]:')
	assertEquals(refs.length, 1)
})
