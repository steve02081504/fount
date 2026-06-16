/**
 * postQuery 纯函数测试（Deno）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { normalizeSearchQuery, postMatchesQuery } from '../src/lib/postQuery.mjs'

Deno.test('postMatchesQuery requires min length and skips protected', () => {
	assertEquals(postMatchesQuery({ content: { text: 'hello world' } }, 'h'), false)
	assertEquals(postMatchesQuery({ content: { protected: true } }, 'hello'), false)
	assertEquals(postMatchesQuery({ content: { text: 'hello world' } }, 'world'), true)
})

Deno.test('postMatchesQuery matches author entity prefix', () => {
	const hash = 'a'.repeat(128)
	assertEquals(postMatchesQuery({
		entityHash: hash,
		content: { text: 'x' },
	}, hash.slice(0, 16)), true)
})

Deno.test('postMatchesQuery is case insensitive', () => {
	assertEquals(postMatchesQuery({ content: { text: 'Foo Bar' } }, 'foo'), true)
})

Deno.test('normalizeSearchQuery detects hashtag', () => {
	assertEquals(normalizeSearchQuery('#Fount').kind, 'hashtag')
	assertEquals(normalizeSearchQuery('#Fount').value, 'fount')
})

Deno.test('postMatchesQuery hashtag does not match unrelated text', () => {
	assertEquals(postMatchesQuery({ content: { text: 'hello #fount world' } }, '#fount'), true)
	assertEquals(postMatchesQuery({ content: { text: 'hello fount' } }, '#fount'), false)
})
