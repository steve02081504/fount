/**
 * Social dispatch：加密帖 @ 提及与通知正文分离。
 */
/* global Deno */
import { extractMentionEntityHashes } from 'fount/public/parts/shells/chat/public/shared/mentions.mjs'
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { mentionSourceText, postTextForNotification } from '../../src/lib/postMentionText.mjs'

const MENTION_HASH = 'a'.repeat(128)

Deno.test('encrypted post: no mention scan on ciphertext body', () => {
	const post = {
		content: {
			scheme: 'gsh',
			postKeyId: 'key-1',
		},
	}
	assertEquals(mentionSourceText(post), '')
	assertEquals(postTextForNotification(post), null)
	assertEquals(extractMentionEntityHashes(mentionSourceText(post)).length, 0)
})

Deno.test('public post: mention and notification text match', () => {
	const post = { content: { text: `hi @${MENTION_HASH}` } }
	assertEquals(mentionSourceText(post), postTextForNotification(post))
})
