/**
 * 关键词/标签屏蔽匹配纯测。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { postMatchesMutedKeywords, pruneMutedKeywordEntries } from '../../src/lib/contentFilter.mjs'

Deno.test('postMatchesMutedKeywords hits body and contentWarning', () => {
	const muted = { entries: [{ pattern: 'spoiler', matchTags: true }] }
	assertEquals(postMatchesMutedKeywords({ content: { text: 'big SPOILER ahead' } }, muted), true)
	assertEquals(postMatchesMutedKeywords({ content: { text: 'ok', contentWarning: 'spoiler alert' } }, muted), true)
	assertEquals(postMatchesMutedKeywords({ content: { text: 'fine' } }, muted), false)
})

Deno.test('postMatchesMutedKeywords matches tags when enabled', () => {
	const muted = { entries: [{ pattern: '#nsfw', matchTags: true }] }
	assertEquals(postMatchesMutedKeywords({ content: { text: 'pic', tags: ['nsfw'] } }, muted), true)
	assertEquals(postMatchesMutedKeywords({ content: { text: '#nsfw' } }, muted), true)
	assertEquals(postMatchesMutedKeywords(
		{ content: { text: 'pic', tags: ['nsfw'] } },
		{ entries: [{ pattern: 'nsfw', matchTags: false }] },
	), false)
})

Deno.test('pruneMutedKeywordEntries drops expired and duplicates', () => {
	const pruned = pruneMutedKeywordEntries([
		{ pattern: 'a' },
		{ pattern: 'A' },
		{ pattern: 'b', expiresAt: Date.now() - 1000 },
		{ pattern: 'c', expiresAt: Date.now() + 60_000 },
	])
	assertEquals(pruned.map(entry => entry.pattern), ['a', 'c'])
})
