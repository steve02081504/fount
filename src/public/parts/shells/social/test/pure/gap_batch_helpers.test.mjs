/**
 * replyPolicy / searchFilters / topic normalize 纯函数测试。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	FOLLOWERS_7D_MS,
	latestFollowWallForAuthor,
	normalizeReplyDisplay,
	normalizeReplyPolicy,
} from '../../src/lib/replyPolicy.mjs'
import {
	hasSearchCriteria,
	parseSearchFilters,
	postMatchesFilters,
} from '../../src/lib/searchFilters.mjs'
import { normalizeTopicTag } from '../../src/topics.mjs'

Deno.test('normalizeReplyPolicy defaults to everyone', () => {
	assertEquals(normalizeReplyPolicy(undefined), 'everyone')
	assertEquals(normalizeReplyPolicy('followers_7d'), 'followers_7d')
	assertEquals(normalizeReplyPolicy('author_follows'), 'author_follows')
	assertEquals(normalizeReplyPolicy('nope'), 'everyone')
})

Deno.test('normalizeReplyDisplay featured_only', () => {
	assertEquals(normalizeReplyDisplay('featured_only'), 'featured_only')
	assertEquals(normalizeReplyDisplay(''), 'all')
})

Deno.test('latestFollowWallForAuthor reads followEvents', () => {
	const author = 'a'.repeat(128)
	const view = {
		following: [author],
		followEvents: [
			{ content: { targetEntityHash: author }, hlc: { wall: 1000 } },
			{ content: { targetEntityHash: author }, hlc: { wall: 5000 } },
		],
	}
	assertEquals(latestFollowWallForAuthor(view, author), 5000)
	assertEquals(latestFollowWallForAuthor({ following: [], followEvents: [] }, author), null)
	assertEquals(FOLLOWERS_7D_MS > 0, true)
})

Deno.test('parseSearchFilters extracts inline tokens', () => {
	const filters = parseSearchFilters({ q: 'hello author:abcd media:video tag:fount' })
	assertEquals(filters.q, 'hello')
	assertEquals(filters.author, 'abcd')
	assertEquals(filters.media, 'video')
	assertEquals(filters.tag, 'fount')
})

Deno.test('postMatchesFilters media and tag', () => {
	const post = {
		entityHash: 'bbbbbbbb',
		content: {
			text: 'hello #fount',
			mediaRefs: [{ kind: 'video' }],
			tags: ['fount'],
		},
		hlc: { wall: 100 },
	}
	assertEquals(postMatchesFilters(post, parseSearchFilters({ media: 'video', tag: 'fount' })), true)
	assertEquals(postMatchesFilters(post, parseSearchFilters({ media: 'image' })), false)
	assertEquals(hasSearchCriteria(parseSearchFilters({ media: 'video' })), true)
})

Deno.test('normalizeTopicTag strips hash', () => {
	assertEquals(normalizeTopicTag('#FoUnt'), 'fount')
})
