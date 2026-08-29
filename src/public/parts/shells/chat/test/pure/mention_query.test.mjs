/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { formatEntityMentionToken } from 'fount/public/parts/shells/chat/public/shared/inlineTokenSyntax.mjs'
import { currentMentionQuery } from 'fount/public/parts/shells/chat/public/shared/mentionQuery.mjs'

const HASH = 'a'.repeat(128)

Deno.test('currentMentionQuery parses bare @', () => {
	assertEquals(currentMentionQuery('hello @', 7), { query: '', start: 6, end: 7 })
})

Deno.test('currentMentionQuery parses plain @query', () => {
	assertEquals(currentMentionQuery('hello @z', 8), { query: 'z', start: 6, end: 8 })
	assertEquals(currentMentionQuery('hello @ZL-31', 12), { query: 'ZL-31', start: 6, end: 12 })
	assertEquals(currentMentionQuery('@a @b', 5), { query: 'b', start: 3, end: 5 })
})

Deno.test('currentMentionQuery parses closed @[query] form', () => {
	assertEquals(currentMentionQuery('hello @[abc]', 12), { query: 'abc', start: 6, end: 12 })
})

Deno.test('currentMentionQuery treats unclosed @[ as no query', () => {
	assertEquals(currentMentionQuery('hello @[abc', 12), null)
})

Deno.test('currentMentionQuery returns null without active mention', () => {
	assertEquals(currentMentionQuery('hello', 5), null)
	assertEquals(currentMentionQuery('hello @foo bar', 14), null)
	assertEquals(currentMentionQuery('hello @@', 8), { query: '', start: 7, end: 8 })
})

Deno.test('currentMentionQuery ignores complete tokens', () => {
	assertEquals(currentMentionQuery(`hi ${formatEntityMentionToken(HASH)}`, 6 + formatEntityMentionToken(HASH).length), null)
	assertEquals(currentMentionQuery('@[role:admin]', 13), null)
})
