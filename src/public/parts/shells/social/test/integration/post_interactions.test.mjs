/**
 * repost / reply / followers-only 可见性。
 */
/* global Deno */
import { randomUUID } from 'node:crypto'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { randomSeed, seedRemoteTimeline } from '../federation/remote_timeline.mjs'
import { createTestSession } from '../harness.mjs'

const getSession = createTestSession()

const append = await import('../../src/timeline/append.mjs')
const materialize = await import('../../src/timeline/materialize.mjs')
const feed = await import('../../src/feed/home.mjs')
const following = await import('../../src/following.mjs')
const { loadViewerContext } = await import('../../src/feed/home.mjs')
const { canViewPost } = await import('../../src/feedVisibility.mjs')
const { pubKeyHash, publicKeyFromSeed } = await import('npm:@steve02081504/fount-p2p/crypto')
const { encodeEntityHash } = await import('npm:@steve02081504/fount-p2p/core/entity_id')

Deno.test('repost materializes and appears in home feed', async () => {
	const { username, operator } = await getSession()
	const signed = await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'original for repost', visibility: 'public', locale: 'zh-CN' },
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

	const { items } = await feed.buildHomeFeed(username, { limit: 50 })
	assert(items.some(row => row.kind === 'repost' && row.postId === view.reposts[0].id))
})

Deno.test('reply chain surfaces via listReplies', async () => {
	const { username, operator } = await getSession()
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

Deno.test('followers-only post hidden when viewer does not follow author', async () => {
	const { username, operator } = await getSession()
	const seed = randomSeed()
	const subject = pubKeyHash(publicKeyFromSeed(seed))
	const foreignOwner = encodeEntityHash('3'.repeat(64), subject)
	await seedRemoteTimeline(username, seed, foreignOwner, [
		{ type: 'social_meta', content: { hideFromDiscovery: false, createdAt: 1 } },
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

Deno.test('owner sees own followers-only post decrypted on profile feed', async () => {
	const { username, operator } = await getSession()
	const postKeyId = randomUUID()
	const encrypted = await import('../../src/vault_crypto/vault.mjs')
	const encContent = await encrypted.maybeEncryptPostContent(
		username, operator, postKeyId,
		{ text: 'followers encrypted', visibility: 'followers', locale: 'zh-CN' },
		'followers',
	)
	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: encContent,
	}, { fanout: false })

	const { items } = await feed.buildProfileFeedItems(username, operator)
	const followersItem = items.find(row => row.post?.content?.text === 'followers encrypted')
	assert(followersItem, 'owner must decrypt followers-only post to plaintext on profile feed')
	assertEquals(followersItem.post.content.visibility, 'followers')
})
