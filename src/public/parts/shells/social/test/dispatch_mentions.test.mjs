/**
 * Social dispatch：受保护帖 @ 提及与通知正文分离。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { extractMentionEntityHashes } from '../src/lib/mentions.mjs'
import { mentionSourceText, postTextForNotification } from '../src/lib/postMentionText.mjs'

const MENTION_HASH = 'a'.repeat(128)

Deno.test('protected post: mention scan uses plaintext, notification text is null', () => {
	const post = {
		content: {
			protected: true,
			text: `hello @${MENTION_HASH}`,
		},
	}
	assertEquals(mentionSourceText(post), `hello @${MENTION_HASH}`)
	assertEquals(postTextForNotification(post), null)
	assertEquals(extractMentionEntityHashes(mentionSourceText(post)).length, 1)
})

Deno.test('public post: mention and notification text match', () => {
	const post = { content: { text: `hi @${MENTION_HASH}` } }
	assertEquals(mentionSourceText(post), postTextForNotification(post))
})
