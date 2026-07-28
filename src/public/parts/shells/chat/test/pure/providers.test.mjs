/**
 * Emoji token / selection helpers（纯逻辑，不拉 browser `/scripts/` 图）。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { formatEmojiToken, parseEmojiToken } from '../../public/shared/inlineTokenSyntax.mjs'

/**
 * 与 chat providers/emoji.mjs tokenForSelection 同语义（供 Deno 纯测）。
 * @param {object} item 选中项
 * @returns {string} 插入 token
 */
function tokenForSelection(item) {
	if (item.kind === 'unicode' && item.unicode) return item.unicode
	if (item.packId && item.emojiId) return formatEmojiToken(item.packId, item.emojiId)
	return item.emojiRef || ''
}

Deno.test('tokenForSelection handles unicode and pack refs', () => {
	assertEquals(tokenForSelection({ kind: 'unicode', unicode: '👍' }), '👍')
	assertEquals(
		tokenForSelection({ packId: 'g1', emojiId: 'e1', emojiRef: formatEmojiToken('g1', 'e1') }),
		formatEmojiToken('g1', 'e1'),
	)
})

Deno.test('parseEmojiToken reads packId/emojiId', () => {
	assertEquals(parseEmojiToken(formatEmojiToken('pack_a', 'emoji_b')), {
		packId: 'pack_a',
		emojiId: 'emoji_b',
	})
	assertEquals(parseEmojiToken('not-a-token'), null)
})
