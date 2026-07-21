/**
 * poll / post_edit / for_you / search cursor 集成测试。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createTestSession } from '../harness.mjs'

const session = createTestSession()

Deno.test('poll vote updates tally projection', async () => {
	const { username, operator } = await session()
	const { commitTimelineEvent } = await import('../../src/timeline/append.mjs')
	const { listPollTally } = await import('../../src/federation/poll/index.mjs')

	const post = await commitTimelineEvent(username, operator, {
		type: 'post',
		content: {
			text: 'poll post',
			visibility: 'public',
			locale: 'zh-CN',
			poll: { options: ['A', 'B'], multi: false, deadline: null },
		},
	})
	await commitTimelineEvent(username, operator, {
		type: 'poll_vote',
		content: {
			targetEntityHash: operator,
			targetPostId: post.id,
			choices: [0],
		},
	})
	const tally = await listPollTally(username, operator, post.id)
	assertEquals(tally['0'], 1)
})

Deno.test('post_edit materializes latest text', async () => {
	const { username, operator } = await session()
	const { commitTimelineEvent } = await import('../../src/timeline/append.mjs')
	const { getTimelineMaterialized } = await import('../../src/timeline/materialize.mjs')

	const post = await commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'before edit', visibility: 'public', locale: 'zh-CN' },
	})
	await commitTimelineEvent(username, operator, {
		type: 'post_edit',
		content: { targetPostId: post.id, text: 'after edit', locale: 'zh-CN' },
	})
	const view = await getTimelineMaterialized(username, operator)
	assertEquals(view.postById[post.id].content.text, 'after edit')
	assertEquals(view.postById[post.id].edited, true)
})

Deno.test('searchPosts returns nextCursor', async () => {
	const { username, operator } = await session()
	const { commitTimelineEvent } = await import('../../src/timeline/append.mjs')
	const { searchPosts } = await import('../../src/search.mjs')

	await commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'alpha unique poll-edit token', visibility: 'public', locale: 'zh-CN' },
	})
	await commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'beta unique poll-edit token', visibility: 'public', locale: 'zh-CN' },
	})
	const page1 = await searchPosts(username, { q: 'unique poll-edit', limit: 1 })
	assertEquals(page1.items.length, 1)
	assert(page1.nextCursor)
	const page2 = await searchPosts(username, { q: 'unique poll-edit', limit: 1, cursor: page1.nextCursor })
	assertEquals(page2.items.length, 1)
	assert(page1.items[0].postId !== page2.items[0].postId)
})

Deno.test('buildForYouFeed returns scored items', async () => {
	const { username, operator } = await session()
	const { commitTimelineEvent } = await import('../../src/timeline/append.mjs')
	const { buildForYouFeed } = await import('../../src/feed/ranking.mjs')

	await commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'for you feed item', visibility: 'public', locale: 'zh-CN' },
	})
	const feed = await buildForYouFeed(username, { viewerEntityHash: operator, limit: 10 })
	assert(feed.items.length >= 1)
	assert(typeof feed.items[0].score === 'number')
})
