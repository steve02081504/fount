/**
 * Emoji token / selection helpers（纯逻辑，不拉 browser `/scripts/` 图）。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { formatEmojiToken, parseEmojiToken, tokenForSelection } from '../../public/shared/inlineTokenSyntax.mjs'

Deno.test('tokenForSelection handles unicode and pack refs', () => {
	assertEquals(tokenForSelection({ kind: 'unicode', unicode: '👍' }), '👍')
	assertEquals(
		tokenForSelection({ packId: 'g1', emojiId: 'e1', emojiRef: formatEmojiToken('g1', 'e1') }),
		formatEmojiToken('g1', 'e1'),
	)
	assertEquals(tokenForSelection({ emojiRef: formatEmojiToken('x', 'y') }), formatEmojiToken('x', 'y'))
	assertEquals(tokenForSelection({}), '')
})

Deno.test('parseEmojiToken reads packId/emojiId', () => {
	assertEquals(parseEmojiToken(formatEmojiToken('pack_a', 'emoji_b')), {
		packId: 'pack_a',
		emojiId: 'emoji_b',
	})
	assertEquals(parseEmojiToken('not-a-token'), null)
})
