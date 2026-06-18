/**
 * 跨 shell emoji 展示结构测试。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { scanEmojiTokens } from '../src/lib/emojiPostEmbed.mjs'

Deno.test('batch12: post with emoji token yields media ref candidates', () => {
	const refs = scanEmojiTokens('see :[privateGroup/customEmoji]: here')
	assertEquals(refs[0]?.groupId, 'privateGroup')
	assertEquals(refs[0]?.emojiId, 'customEmoji')
})
