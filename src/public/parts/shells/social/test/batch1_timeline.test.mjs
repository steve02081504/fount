/**
 * Batch 1：时间线核心写盘链路。
 * append / materialize / follow / unfollow / profile 读写 / post / like / repost / social_meta。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { bootstrap } from './harness.mjs'

const { username, operator } = await bootstrap()

const append = await import('../src/timeline/append.mjs')
const materialize = await import('../src/timeline/materialize.mjs')
const following = await import('../src/following.mjs')
const socialMeta = await import('../src/socialMeta.mjs')
const feed = await import('../src/feed.mjs')
const { resolveOperatorEntityHashForUser } = await import('../../../../../server/p2p_server/operator_identity.mjs')

const TARGET_A = 'a'.repeat(128)
const TARGET_B = 'b'.repeat(128)
const POST_ID_HEX = 'c'.repeat(64)

Deno.test('bootstrap created operator timeline with social_meta genesis', async () => {
	const view = await materialize.getTimelineMaterialized(username, operator)
	assert(view.socialMeta && typeof view.socialMeta === 'object')
	assertEquals(view.posts.length, 0)
})

Deno.test('canWriteTimeline true for operator, false for foreign entity', async () => {
	assertEquals(await append.canWriteTimeline(username, operator), true)
	assertEquals(await append.canWriteTimeline(username, TARGET_A), false)
})

Deno.test('post → materialize roundtrip', async () => {
	const signed = await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'hello world', visibility: 'public', lang: 'zh-CN' },
	}, { fanout: false })
	assert(signed.id && signed.signature && signed.senderPubKey)
	const view = await materialize.getTimelineMaterialized(username, operator)
	assertEquals(view.posts.length, 1)
	assertEquals(view.posts[0].content.text, 'hello world')
	assertEquals(view.postById[signed.id].id, signed.id)
})

Deno.test('follow then unfollow reflected in materialized following', async () => {
	const afterFollow = await following.setFollow(username, TARGET_A, true)
	assert(afterFollow.includes(TARGET_A))
	let view = await materialize.getTimelineMaterialized(username, operator)
	assert(view.following.includes(TARGET_A))

	// idempotent: re-follow returns same list, no duplicate event
	const reFollow = await following.setFollow(username, TARGET_A, true)
	assertEquals(reFollow.filter(h => h === TARGET_A).length, 1)

	const afterUnfollow = await following.setFollow(username, TARGET_A, false)
	assert(!afterUnfollow.includes(TARGET_A))
	view = await materialize.getTimelineMaterialized(username, operator)
	assert(!view.following.includes(TARGET_A))
})

Deno.test('loadFollowing reads from materialized timeline (no following.json)', async () => {
	await following.setFollow(username, TARGET_B, true)
	const { following: list } = await following.loadFollowing(username)
	assert(list.includes(TARGET_B))
	await following.setFollow(username, TARGET_B, false)
})

Deno.test('like then unlike via reducer', async () => {
	await append.commitTimelineEvent(username, operator, {
		type: 'like',
		content: { targetEntityHash: TARGET_A, targetPostId: POST_ID_HEX },
	}, { fanout: false })
	let view = await materialize.getTimelineMaterialized(username, operator)
	assertEquals(view.likes.length, 1)

	await append.commitTimelineEvent(username, operator, {
		type: 'unlike',
		content: { targetEntityHash: TARGET_A, targetPostId: POST_ID_HEX },
	}, { fanout: false })
	view = await materialize.getTimelineMaterialized(username, operator)
	assertEquals(view.likes.length, 0)
})

Deno.test('post_delete removes post from materialized view', async () => {
	const signed = await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'to be deleted', visibility: 'public' },
	}, { fanout: false })
	let view = await materialize.getTimelineMaterialized(username, operator)
	assert(view.postById[signed.id])

	await append.commitTimelineEvent(username, operator, {
		type: 'post_delete',
		content: { targetPostId: signed.id },
	}, { fanout: false })
	view = await materialize.getTimelineMaterialized(username, operator)
	assert(!view.postById[signed.id], 'deleted post should be gone')
})

Deno.test('updateSocialMeta patches isProtected/exploreBlurb', async () => {
	const meta = await socialMeta.updateSocialMeta(username, operator, {
		isProtected: true,
		exploreBlurb: 'hi there',
	})
	assertEquals(meta.isProtected, true)
	assertEquals(meta.exploreBlurb, 'hi there')
	// reset
	await socialMeta.updateSocialMeta(username, operator, { isProtected: false })
})

Deno.test('getEntityProfile returns profile for operator', async () => {
	const profile = await feed.getEntityProfile(username, operator)
	assert(profile, 'operator profile should auto-create')
})

Deno.test('assertWritableTimeline rejects foreign entity', async () => {
	let threw = false
	try {
		await append.appendTimelineEvent(username, TARGET_A, { type: 'post', content: { text: 'x' } })
	}
	catch { threw = true }
	assert(threw, 'should reject write to foreign timeline')
})

Deno.test('operator entityHash stable across resolves', async () => {
	assertEquals(await resolveOperatorEntityHashForUser(username), operator)
})
