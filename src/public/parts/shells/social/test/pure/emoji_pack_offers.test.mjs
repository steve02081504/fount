/**
 * social author pack offer 清洗。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std/assert/mod.ts'

import { sanitizeAuthorPackOffer } from '../../src/emojiPacks/discoverNetwork.mjs'

Deno.test('sanitizeAuthorPackOffer accepts entity offers', () => {
	const offer = sanitizeAuthorPackOffer({
		packId: 'epack_1',
		sourceId: 'aa'.repeat(64),
		itemCount: 2,
		localized: { 'en-UK': { name: 'Author Pack' } },
	})
	assertEquals(offer?.sourceKind, 'entity')
	assertEquals(offer?.packId, 'epack_1')
	assertEquals(offer?.sourceId, 'aa'.repeat(64))
})

Deno.test('sanitizeAuthorPackOffer rejects incomplete rows', () => {
	assertEquals(sanitizeAuthorPackOffer({}), null)
	assertEquals(sanitizeAuthorPackOffer({ packId: 'x' }), null)
})
