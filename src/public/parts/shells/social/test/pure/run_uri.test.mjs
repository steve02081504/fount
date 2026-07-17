/**
 * Social runUri 深链测试。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { formatSocialPostHref, formatSocialSearchHref, parseSocialRunUri } from '../../public/shared/runUri.mjs'

Deno.test('formatSocialSearchHref encodes hashtag query', () => {
	assertEquals(formatSocialSearchHref('#fount'), '/parts/shells:social/#search;fount')
	assertEquals(formatSocialSearchHref('hello'), '/parts/shells:social/#search;hello')
})

Deno.test('parseSocialRunUri reads search subcommand', () => {
	const parsed = parseSocialRunUri('search;fount')
	assertEquals(parsed?.subcommand, 'search')
	assertEquals(parsed?.searchQuery, 'fount')
})

Deno.test('parseSocialRunUri reads post detail', () => {
	const parsed = parseSocialRunUri('post;abc;pid1')
	assertEquals(parsed?.subcommand, 'post')
	assertEquals(parsed?.entityHash, 'abc')
	assertEquals(parsed?.postId, 'pid1')
})

Deno.test('formatSocialPostHref builds detail hash', () => {
	assertEquals(formatSocialPostHref('eh', 'pid'), '/parts/shells:social/#post;eh;pid')
})
