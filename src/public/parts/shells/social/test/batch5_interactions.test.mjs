/**
 * Batch 5：repost / reply / followers-only 可见性。
 * 复测：deno test --no-check --allow-all src/public/parts/shells/social/test/batch5_interactions.test.mjs
 */
/* global Deno */
import { randomUUID } from 'node:crypto'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { bootstrap, randomSeed, seedRemoteTimeline } from './harness.mjs'

const { username, operator } = await bootstrap()

const append = await import('../src/timeline/append.mjs')
const materialize = await import('../src/timeline/materialize.mjs')
const feed = await import('../src/feed.mjs')
const following = await import('../src/following.mjs')
const { canViewPost, loadViewerContext } = await import('../src/feedHelpers.mjs')

Deno.test('repost materializes and appears in home feed', async () => {
	const signed = await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'original for repost', visibility: 'public', lang: 'zh-CN' },
	}, { fanout: false })
	await append.commitTimelineEvent(username, operator, {
		type: 'repost',
		content: {
			targetEntityHash: operator,
			targetPostId: signed.id,
			comment: 'boosting',
		},
	}, { fanout: false })

	const view = await materialize.getTimelineMaterialized(username, operator)
	assertEquals(view.reposts.length, 1)
	assertEquals(view.reposts[0].content.comment, 'boosting')

	await following.setFollow(username, operator, true)
	const { items } = await feed.buildHomeFeed(username, { limit: 50 })
	assert(items.some(row => row.kind === 'repost' && row.postId === view.reposts[0].id))
})

Deno.test('reply chain surfaces via listReplies', async () => {
	const parent = await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'parent thread', visibility: 'public' },
	}, { fanout: false })
	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: {
			text: 'child reply',
			visibility: 'public',
			replyTo: { entityHash: operator, postId: parent.id },
		},
	}, { fanout: false })

	const replies = await feed.listReplies(username, operator, parent.id)
	assertEquals(replies.length, 1)
	assertEquals(replies[0].post.content.text, 'child reply')
})

const { pubKeyHash, publicKeyFromSeed } = await import('../../../../../scripts/p2p/crypto.mjs')
const { encodeEntityHash } = await import('../../../../../scripts/p2p/entity_id.mjs')

Deno.test('followers-only post hidden when viewer does not follow author', async () => {
	const seed = randomSeed()
	const subject = pubKeyHash(publicKeyFromSeed(seed))
	const foreignOwner = encodeEntityHash('3'.repeat(64), subject)
	await seedRemoteTimeline(username, seed, foreignOwner, [
		{ type: 'social_meta', content: { isProtected: false, createdAt: 1 } },
		{ type: 'post', content: { text: 'secret followers', visibility: 'followers' } },
	])

	const viewerContext = await loadViewerContext(username)
	viewerContext.following = new Set([operator])
	const view = await materialize.getTimelineMaterialized(username, foreignOwner)
	const secret = view.posts[0]
	assert(!canViewPost({ ...secret, entityHash: foreignOwner }, viewerContext))

	viewerContext.following = new Set([operator, foreignOwner])
	assert(canViewPost({ ...secret, entityHash: foreignOwner }, viewerContext))
})

Deno.test('profile feed includes public posts only for viewer', async () => {
	const postKeyId = randomUUID()
	const encrypted = await import('../src/vault_crypto/vault.mjs')
	const encContent = await encrypted.maybeEncryptPostContent(
		username, operator, postKeyId,
		{ text: 'followers encrypted', visibility: 'followers', lang: 'zh-CN' },
		'followers',
	)
	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: encContent,
	}, { fanout: false })

	const { items } = await feed.buildProfileFeedItems(username, operator)
	const protectedItem = items.find(row => row.post?.content?.protected || row.post?.content?.scheme === 'gsh')
	assert(protectedItem, 'owner should see decrypted or protected marker on profile feed')
})
