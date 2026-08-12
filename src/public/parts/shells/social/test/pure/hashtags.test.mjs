/**
 * 话题提取与匹配测试。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { extractHashtagsFromText } from '../../src/lib/hashtags.mjs'
import { postMatchesQuery } from '../../src/lib/postQuery.mjs'

Deno.test('extractHashtagsFromText skips group refs', () => {
	const tags = extractHashtagsFromText('see #[channel:mygroup/default] and #hello')
	assertEquals(tags.includes('hello'), true)
	assertEquals(tags.includes('mygroup'), false)
})

Deno.test('extractHashtagsFromText preserves case', () => {
	assertEquals(extractHashtagsFromText('#Foo #foo'), ['Foo', 'foo'])
})

Deno.test('extractHashtagsFromText skips fenced code blocks', () => {
	const tags = extractHashtagsFromText('intro #keep\n```mjs\nconst x = "#feedlist"\n#plug\n```\noutro #also')
	assertEquals(tags, ['keep', 'also'])
})

Deno.test('extractHashtagsFromText skips tilde fences and inline code', () => {
	const tags = extractHashtagsFromText('see `#inline` and\n~~~\n#fence\n~~~\nplus #real')
	assertEquals(tags, ['real'])
})

Deno.test('extractHashtagsFromText skips multi-backtick inline code', () => {
	assertEquals(extractHashtagsFromText('code `` `#nested` `` then #ok'), ['ok'])
})

Deno.test('postMatchesQuery uses hashtag tokens only', () => {
	assertEquals(postMatchesQuery({ content: { text: 'say hello' } }, '#hello'), false)
	assertEquals(postMatchesQuery({ content: { text: '#hello world' } }, '#hello'), true)
	assertEquals(postMatchesQuery({ content: { text: '```\n#hello\n```' } }, '#hello'), false)
})
