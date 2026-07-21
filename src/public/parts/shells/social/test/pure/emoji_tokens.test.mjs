/**
 * Social emoji token 扫描与展示结构测试。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { formatEmojiToken } from '../../../chat/public/shared/inlineTokenSyntax.mjs'
import { buildEmojiMediaRefsForPost, scanEmojiTokens } from '../../src/lib/emojiPostEmbed.mjs'

Deno.test('post with emoji token yields media ref candidates', () => {
	const refs = scanEmojiTokens(`see ${formatEmojiToken('privateGroup', 'customEmoji')} here`)
	assertEquals(refs[0]?.groupId, 'privateGroup')
	assertEquals(refs[0]?.emojiId, 'customEmoji')
})

Deno.test('scanEmojiTokens deduplicates repeated tokens', () => {
	const token = formatEmojiToken('a', 'b')
	const refs = scanEmojiTokens(`${token} ${token}`)
	assertEquals(refs.length, 1)
})

Deno.test('scanEmojiTokens requires typed emoji prefix and trailing colon', () => {
	const refs = scanEmojiTokens(`seed ${formatEmojiToken('g1', 'e1')} tail`)
	assertEquals(refs, [{ groupId: 'g1', emojiId: 'e1' }])
	assertEquals(scanEmojiTokens('see :[g1/e1]: without emoji prefix'), [])
	assertEquals(scanEmojiTokens('see :[emoji:g1/e1] without trailing colon'), [])
})

Deno.test('buildEmojiMediaRefsForPost empty when no emoji tokens', async () => {
	const mediaRefs = await buildEmojiMediaRefsForPost('user', 'plain text without tokens')
	assertEquals(mediaRefs, [])
})

Deno.test('feed mediaRef shape for groupEmoji embed', () => {
	const contentHash = 'a'.repeat(64)
	const refs = scanEmojiTokens(formatEmojiToken('g1', 'e1'))
	const mediaRefs = refs.map(({ groupId, emojiId }) => ({
		kind: 'groupEmoji',
		groupId,
		emojiId,
		contentHash,
	}))
	assertEquals(mediaRefs[0].kind, 'groupEmoji')
	assertEquals(mediaRefs[0].contentHash.length, 64)
})
