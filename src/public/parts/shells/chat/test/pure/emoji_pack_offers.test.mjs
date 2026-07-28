/**
 * emoji pack offer 清洗。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { sanitizeEmojiPackOffer } from '../../src/emojiPacks/discoverNetwork.mjs'

Deno.test('sanitizeEmojiPackOffer accepts group offers', () => {
	const offer = sanitizeEmojiPackOffer({
		packId: 'p1',
		sourceKind: 'group',
		sourceId: 'g1',
		itemCount: 3,
		localized: { 'en-UK': { name: 'Pack' } },
		nodeHash: 'ab'.repeat(32),
	})
	assertEquals(offer?.packId, 'p1')
	assertEquals(offer?.sourceKind, 'group')
	assertEquals(offer?.sourceId, 'g1')
	assertEquals(offer?.itemCount, 3)
})

Deno.test('sanitizeEmojiPackOffer rejects incomplete rows', () => {
	assertEquals(sanitizeEmojiPackOffer(null), null)
	assertEquals(sanitizeEmojiPackOffer({ packId: 'p1' }), null)
	assertEquals(sanitizeEmojiPackOffer({ sourceId: 'g1' }), null)
})

Deno.test('sanitizeEmojiPackOffer drops non-hex nodeHash', () => {
	const offer = sanitizeEmojiPackOffer({
		packId: 'p1',
		sourceId: 'g1',
		nodeHash: 'not-hex!!',
	})
	assertEquals(offer?.nodeHash, '')
})
