/**
 * 搜索 / 探索 / 热门话题。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createTestSession } from '../harness.mjs'

const getSession = createTestSession()

const append = await import('../../src/timeline/append.mjs')
const search = await import('../../src/search.mjs')
const discovery = await import('../../src/discovery.mjs')
const trending = await import('../../src/trending/hashtags.mjs')

Deno.test('searchPosts finds operator post by hashtag', async () => {
	const { username, operator } = await getSession()
	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'hello #SearchTagBatch9', visibility: 'public' },
	}, { fanout: false })

	const { items, query } = await search.searchPosts(username, { q: '#SearchTagBatch9', limit: 10 })
	assertEquals(query, '#SearchTagBatch9')
	assert(items.length >= 1)
})

Deno.test('searchPosts returns empty for short query', async () => {
	const { username } = await getSession()
	const { items } = await search.searchPosts(username, { q: 'a', limit: 10 })
	assertEquals(items.length, 0)
})

Deno.test('discoverPosts samples public posts', async () => {
	const { username, operator } = await getSession()
	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'discover sample post', visibility: 'public' },
	}, { fanout: false })

	const { posts } = await discovery.discoverPosts(username, { n: 20 })
	assert(posts.some(p => p.entityHash === operator))
})

Deno.test('discoverPosts skips followers-only visibility', async () => {
	const { username, operator } = await getSession()
	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'discoverSecretFollowersOnly', visibility: 'followers' },
	}, { fanout: false })

	const { posts } = await discovery.discoverPosts(username, { n: 50 })
	assert(!posts.some(p => p.textSnippet?.includes('discoverSecretFollowersOnly')))
})

Deno.test('buildTrendingHashtags counts visible hashtag posts', async () => {
	const { username, operator } = await getSession()
	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'hello #TrendTagSearch', visibility: 'public' },
	}, { fanout: false })

	const { tags } = await trending.buildTrendingHashtags(username, { limit: 20 })
	assert(tags.some(row => row.tag === 'trendtagsearch' && row.count >= 1))
})
