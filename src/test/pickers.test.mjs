/**
 * Emoji / sticker provider 单测（不依赖 DOM 与 registry 聚合）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import emojiProvider from '../public/parts/shells/chat/public/providers/emoji.mjs'
import stickerProvider from '../public/parts/shells/chat/public/providers/sticker.mjs'

Deno.test('emoji provider tokenForSelection handles unicode and group refs', () => {
	assertEquals(emojiProvider.tokenForSelection({ unicode: '👍' }), '👍')
	assertEquals(
		emojiProvider.tokenForSelection({ groupId: 'g1', emojiId: 'e1', emojiRef: ':[g1/e1]:' }),
		':[g1/e1]:',
	)
	assertEquals(
		emojiProvider.tokenForSelection({ groupId: 'g2', emojiId: 'e2' }),
		':[g2/e2]:',
	)
})

Deno.test('emoji provider isGroupEmojiItem detects custom entries', () => {
	assertEquals(emojiProvider.isGroupEmojiItem({ kind: 'custom', groupId: 'g', emojiId: 'e' }), true)
	assertEquals(emojiProvider.isGroupEmojiItem({ kind: 'unicode', unicode: 'x' }), false)
})

Deno.test('sticker provider tokenForSelection', () => {
	assertEquals(stickerProvider.tokenForSelection({ token: 'custom' }), 'custom')
	assertEquals(stickerProvider.tokenForSelection({ stickerId: 's1' }), ':[sticker/s1]:')
})
