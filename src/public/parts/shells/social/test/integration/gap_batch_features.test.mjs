/**
 * 定时发布 / 话题订阅 / 门控 / 直播会话集成测试。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createTestSession } from '../harness.mjs'

const getSession = createTestSession()

Deno.test('scheduled post enqueue and cancel', async () => {
	const { username, operator } = await getSession()
	const { enqueueScheduledPost, listScheduledPosts, cancelScheduledPost } = await import('../../src/lib/scheduledPosts.mjs')
	const publishAt = Date.now() + 60_000
	const row = enqueueScheduledPost(username, operator, { text: 'later post' }, publishAt)
	assert(row.scheduledId)
	assertEquals(listScheduledPosts(username, operator).some(r => r.scheduledId === row.scheduledId), true)
	const removed = cancelScheduledPost(username, operator, row.scheduledId)
	assertEquals(removed?.scheduledId, row.scheduledId)
	assertEquals(listScheduledPosts(username, operator).some(r => r.scheduledId === row.scheduledId), false)
})

Deno.test('tag_follow materializes followedTags', async () => {
	const { username, operator } = await getSession()
	const { getSocialClient } = await import('../../src/api/index.mjs')
	const client = await getSocialClient(username)
	assertEquals(client.entityHash, operator)
	const result = await client.followTopic('gaptest', true)
	assertEquals(result.isFollowing, true)
	assert(result.tags.includes('gaptest'))
	const listed = await client.followedTopics()
	assert(listed.tags.includes('gaptest'))
	await client.followTopic('gaptest', false)
	const after = await client.followedTopics()
	assertEquals(after.tags.includes('gaptest'), false)
})

Deno.test('replyPolicy followers_7d rejects non-follower', async () => {
	const { username, operator } = await getSession()
	const { canReplyUnderPolicy } = await import('../../src/lib/replyPolicy.mjs')
	const { getTimelineMaterialized } = await import('../../src/timeline/materialize.mjs')

	assertEquals(await canReplyUnderPolicy({
		username,
		authorEntityHash: operator,
		replierEntityHash: operator,
		replyPolicy: 'followers_7d',
	}), true)

	assertEquals(await canReplyUnderPolicy({
		username,
		authorEntityHash: operator,
		replierEntityHash: 'c'.repeat(128),
		replyPolicy: 'followers_7d',
		at: Date.now(),
	}), false)

	const view = await getTimelineMaterialized(username, operator)
	assert(Array.isArray(view.followedTags))
})

Deno.test('live session start stop', async () => {
	const { username } = await getSession()
	const { getSocialClient } = await import('../../src/api/index.mjs')
	const client = await getSocialClient(username)
	const session = await client.startLive({ title: 'test live' })
	assertEquals(session.status, 'live')
	assert(session.liveId)
	assert(session.avRoomId)
	const feed = await client.liveFeed({ limit: 10 })
	assert(feed.items.some(row => row.liveId === session.liveId))
	const ended = await client.stopLive(session.liveId)
	assertEquals(ended.status, 'ended')
})
