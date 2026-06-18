/**
 * Batch 8：通知与 dispatch 主流程。
 * 复测：deno test --no-check --allow-all src/public/parts/shells/social/test/batch8_notifications_dispatch.test.mjs
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { bootstrap, randomSeed, seedRemoteTimeline } from './harness.mjs'

const { username, operator } = await bootstrap()

const append = await import('../src/timeline/append.mjs')
const notifications = await import('../src/notifications.mjs')
const dispatch = await import('../src/dispatch.mjs')
const following = await import('../src/following.mjs')
const { pubKeyHash, publicKeyFromSeed } = await import('../../../../../scripts/p2p/crypto.mjs')
const { encodeEntityHash } = await import('../../../../../scripts/p2p/entity_id.mjs')

const POST_ID = 'd'.repeat(64)

Deno.test('buildNotifications includes like repost follow reply mention', async () => {
	const parent = await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'notify me', visibility: 'public' },
	}, { fanout: false })

	const seed = randomSeed()
	const subject = pubKeyHash(publicKeyFromSeed(seed))
	const remoteOwner = encodeEntityHash('4'.repeat(64), subject)
	await seedRemoteTimeline(username, seed, remoteOwner, [
		{ type: 'social_meta', content: { isProtected: false, createdAt: 1 } },
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

	await following.setFollow(username, remoteOwner, true)

	const { notifications: rows, viewerEntityHash } = await notifications.buildNotifications(username, 50)
	assertEquals(viewerEntityHash, operator)
	const types = new Set(rows.map(r => r.type))
	assert(types.has('like'))
	assert(types.has('repost'))
	assert(types.has('follow'))
	assert(types.has('reply'))
	assert(types.has('mention'))
})

Deno.test('dispatchPostMentions no-op when post has no mentions', async () => {
	const post = await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'no mentions here', visibility: 'public' },
	}, { fanout: false })
	await dispatch.dispatchPostMentions(username, operator, post)
	const view = await append.readTimelineEvents(username, operator)
	assertEquals(view.filter(e => e.type === 'post' && e.content?.replyTo).length, 0)
})

Deno.test('processSocialOnMentionRpc returns ok false for unknown entity', async () => {
	const result = await dispatch.processSocialOnMentionRpc(username, {
		targetEntityHash: 'f'.repeat(128),
		authorEntityHash: operator,
		postId: POST_ID,
		postText: 'hi',
	})
	assertEquals(result.ok, false)
})
