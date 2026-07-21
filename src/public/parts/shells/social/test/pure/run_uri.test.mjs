/**
 * Social runUri 深链测试。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	formatSocialPostHref,
	formatSocialPostPageUri,
	formatSocialProfileHref,
	formatSocialSearchHref,
	parseSocialRunUri,
} from '../../public/shared/runUri.mjs'

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
	assertEquals(parsed?.sharerNodeHash, undefined)
})

Deno.test('parseSocialRunUri reads post with sharerNodeHash', () => {
	const parsed = parseSocialRunUri('post;abc;pid1;nodehash64')
	assertEquals(parsed?.subcommand, 'post')
	assertEquals(parsed?.entityHash, 'abc')
	assertEquals(parsed?.postId, 'pid1')
	assertEquals(parsed?.sharerNodeHash, 'nodehash64')
})

Deno.test('formatSocialPostHref builds detail hash', () => {
	assertEquals(formatSocialPostHref('eh', 'pid'), '/parts/shells:social/#post;eh;pid')
	assertEquals(formatSocialPostHref('eh', 'pid', 'nh'), '/parts/shells:social/#post;eh;pid;nh')
})

Deno.test('formatSocialProfileHref optional focus post', () => {
	assertEquals(formatSocialProfileHref('eh'), '/parts/shells:social/#profile;eh')
	assertEquals(formatSocialProfileHref('eh', 'pid'), '/parts/shells:social/#profile;eh;pid')
})

Deno.test('formatSocialPostPageUri for external share', () => {
	assertEquals(formatSocialPostPageUri('eh', 'pid', 'nh'), 'fount://page/parts/shells:social/#post;eh;pid;nh')
})
