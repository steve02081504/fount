/**
 * 话题提取与匹配测试。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { extractHashtagsFromText } from '../../src/lib/hashtags.mjs'
import { postMatchesQuery } from '../../src/lib/postQuery.mjs'

Deno.test('extractHashtagsFromText skips group refs', () => {
	const tags = extractHashtagsFromText('see #[channel:mygroup/default] and #hello')
	assertEquals(tags.includes('hello'), true)
	assertEquals(tags.includes('mygroup'), false)
})

Deno.test('extractHashtagsFromText dedupes case', () => {
	assertEquals(extractHashtagsFromText('#Foo #foo'), ['foo'])
})

Deno.test('postMatchesQuery uses hashtag tokens only', () => {
	assertEquals(postMatchesQuery({ content: { text: 'say hello' } }, '#hello'), false)
	assertEquals(postMatchesQuery({ content: { text: '#hello world' } }, '#hello'), true)
})
