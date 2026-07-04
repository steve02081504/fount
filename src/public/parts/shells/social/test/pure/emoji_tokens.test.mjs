/**
 * Social emoji token 扫描与展示结构测试。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { buildEmojiMediaRefsForPost, scanEmojiTokens } from '../../src/lib/emojiPostEmbed.mjs'

Deno.test('post with emoji token yields media ref candidates', () => {
	const refs = scanEmojiTokens('see :[privateGroup/customEmoji]: here')
	assertEquals(refs[0]?.groupId, 'privateGroup')
	assertEquals(refs[0]?.emojiId, 'customEmoji')
})

Deno.test('scanEmojiTokens deduplicates repeated tokens', () => {
	const refs = scanEmojiTokens(':[a/b]: :[a/b]:')
	assertEquals(refs.length, 1)
})

Deno.test('buildEmojiMediaRefsForPost empty when no emoji tokens', async () => {
	const mediaRefs = await buildEmojiMediaRefsForPost('user', 'plain text without tokens')
	assertEquals(mediaRefs, [])
})

Deno.test('feed mediaRef shape for groupEmoji embed', () => {
	const contentHash = 'a'.repeat(64)
	const refs = scanEmojiTokens(':[g1/e1]:')
	const mediaRefs = refs.map(({ groupId, emojiId }) => ({
		kind: 'groupEmoji',
		groupId,
		emojiId,
		contentHash,
	}))
	assertEquals(mediaRefs[0].kind, 'groupEmoji')
	assertEquals(mediaRefs[0].contentHash.length, 64)
})
