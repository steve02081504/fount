/**
 * 通知与 dispatch 主流程。
 */
/* global Deno */
import { placeholderEntityHash } from 'fount/scripts/test/fixtures.mjs'
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { randomSeed, seedRemoteTimeline } from '../federation/remote_timeline.mjs'
import { createTestSession } from '../harness.mjs'

const getSession = createTestSession()

const append = await import('../../src/timeline/append.mjs')
const notifications = await import('../../src/notifications.mjs')
const dispatch = await import('../../src/dispatch.mjs')
const following = await import('../../src/following.mjs')
const { pubKeyHash, publicKeyFromSeed } = await import('fount/scripts/p2p/crypto.mjs')
const { encodeEntityHash } = await import('fount/scripts/p2p/entity_id.mjs')

const POST_ID = 'd'.repeat(64)

Deno.test('buildNotifications includes like repost follow reply mention', async () => {
	const { username, operator } = await getSession()
	const parent = await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'notify me', visibility: 'public' },
	}, { fanout: false })

	const seed = randomSeed()
	const subject = pubKeyHash(publicKeyFromSeed(seed))
	const remoteOwner = encodeEntityHash('4'.repeat(64), subject)
	await seedRemoteTimeline(username, seed, remoteOwner, [
		{ type: 'social_meta', content: { hideFromDiscovery: false, createdAt: 1 } },
		{ type: 'follow', content: { targetEntityHash: operator, rep_edge: 1 } },
		{ type: 'like', content: { targetEntityHash: operator, targetPostId: parent.id } },
		{ type: 'repost', content: { targetEntityHash: operator, targetPostId: parent.id, comment: 'nice' } },
		{ type: 'post', content: {
			text: `reply @${operator}`,
			visibility: 'public',
			replyTo: { entityHash: operator, postId: parent.id },
		} },
		{ type: 'post', content: {
			text: `hello @${operator} there`,
			visibility: 'public',
		} },
	])

	await following.setFollow(username, operator, remoteOwner, true)

	const { notifications: rows, viewerEntityHash } = await notifications.buildNotifications(username, { limit: 50 })
	assertEquals(viewerEntityHash, operator)
	const types = new Set(rows.map(r => r.type))
	assert(types.has('like'))
	assert(types.has('repost'))
	assert(types.has('follow'))
	assert(types.has('reply'))
	assert(types.has('mention'))
	assert(rows.every(row => 'actorEntityHash' in row && row.postId !== undefined && row.targetPostId !== undefined))
})

Deno.test('dispatchPostMentions no-op when post has no mentions', async () => {
	const { username, operator } = await getSession()
	const beforeCount = (await append.readTimelineEvents(username, operator)).length
	const post = await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'no mentions here', visibility: 'public' },
	}, { fanout: false })
	await dispatch.dispatchPostMentions(username, operator, post)
	const after = await append.readTimelineEvents(username, operator)
	assertEquals(after.length, beforeCount + 1, 'dispatch must not append mention side-effects')
})

Deno.test('processSocialOnMentionRpc returns ok false for unknown entity', async () => {
	const { username, operator } = await getSession()
	const result = await dispatch.processSocialOnMentionRpc(username, {
		targetEntityHash: placeholderEntityHash('f'),
		authorEntityHash: operator,
		postId: POST_ID,
		postText: 'hi',
	})
	assertEquals(result.ok, false)
})
