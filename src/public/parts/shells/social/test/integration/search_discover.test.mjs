/**
 * 搜索 / 探索 / 热门话题。
 */
/* global Deno */
import { mkdir, writeFile } from 'node:fs/promises'

import { assert, assertEquals } from 'jsr:@std/assert'

import { createTestSession } from '../harness.mjs'

const getSession = createTestSession()

const append = await import('../../src/timeline/append.mjs')
const search = await import('../../src/search.mjs')
const discoverLocal = await import('../../src/discover/local.mjs')
const trending = await import('../../src/trending/hashtags.mjs')
const paths = await import('../../src/paths.mjs')
const searchIndex = await import('../../src/searchIndex.mjs')

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

Deno.test('discoverPosts returns public posts newest-first', async () => {
	const { username, operator } = await getSession()
	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'discover sample post', visibility: 'public' },
	}, { fanout: false })

	const { posts } = await discoverLocal.discoverPosts(username, { n: 20 })
	assert(posts.some(p => p.entityHash === operator))
})

Deno.test('discoverPosts skips followers-only visibility', async () => {
	const { username, operator } = await getSession()
	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'discoverSecretFollowersOnly', visibility: 'followers' },
	}, { fanout: false })

	const { posts } = await discoverLocal.discoverPosts(username, { n: 50 })
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

Deno.test('buildTrendingHashtags skips hashtags inside code fences', async () => {
	const { username, operator } = await getSession()
	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: {
			text: 'real #TrendOutsideCode\n```js\n#feedlist\n#plug\n```\n',
			visibility: 'public',
		},
	}, { fanout: false })

	const { tags } = await trending.buildTrendingHashtags(username, { limit: 32 })
	assert(tags.some(row => row.tag === 'trendoutsidecode' && row.count >= 1))
	assert(!tags.some(row => row.tag === 'feedlist' || row.tag === 'plug'))
})

Deno.test('trending display prunes phantoms and keeps live tags', async () => {
	const { username, operator } = await getSession()
	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: {
			text: 'keep #TrendKeepReal\n```\n#phantomfeedlist\n#phantomplug\n```',
			visibility: 'public',
		},
	}, { fanout: false })

	const indexDir = paths.socialSearchIndexPath(username)
	await mkdir(indexDir, { recursive: true })
	await writeFile(paths.socialTrendingIndexPath(username), `${JSON.stringify({
		phantomfeedlist: 9,
		phantomplug: 7,
		trendkeepreal: 1,
	})}\n`, 'utf8')

	const { tags } = await trending.buildTrendingHashtags(username, { limit: 12 })
	assert(tags.some(row => row.tag === 'trendkeepreal' && row.count >= 1))
	assert(!tags.some(row => row.tag === 'phantomfeedlist' || row.tag === 'phantomplug'))
})

Deno.test('deleting a post drops its hashtags from trending', async () => {
	const { username, operator } = await getSession()
	const tag = `trenddelete${Date.now().toString(36)}`
	const row = await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: `soon gone #${tag}`, visibility: 'public' },
	}, { fanout: false })

	let { tags } = await searchIndex.readTrendingHashtagCounts(username, 32)
	assert(tags.some(entry => entry.tag === tag && entry.count >= 1))

	await append.commitTimelineEvent(username, operator, {
		type: 'post_delete',
		content: { targetPostId: row.id },
	}, { fanout: false })

	;({ tags } = await searchIndex.readTrendingHashtagCounts(username, 32))
	assert(!tags.some(entry => entry.tag === tag))
})
