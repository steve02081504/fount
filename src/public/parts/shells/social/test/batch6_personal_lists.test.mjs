/**
 * Batch 6：个人 block / hide 写路径。
 * 复测：deno test --no-check --allow-all src/public/parts/shells/social/test/batch6_personal_lists.test.mjs
 */
/* global Deno */
import { assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { setPersonalHidden } from '../../../../../scripts/p2p/personal_block.mjs'

import { bootstrap, randomSeed, seedRemoteTimeline } from './harness.mjs'

const { username, operator } = await bootstrap()

const personalBlock = await import('../src/personalBlock.mjs')
const materialize = await import('../src/timeline/materialize.mjs')
const { canViewPost, loadViewerContext } = await import('../src/feedHelpers.mjs')
const { pubKeyHash, publicKeyFromSeed } = await import('../../../../../scripts/p2p/crypto.mjs')
const { encodeEntityHash } = await import('../../../../../scripts/p2p/entity_id.mjs')

const TARGET = 'b'.repeat(128)

Deno.test('setPersonalBlock block then unblock updates materialized blocked', async () => {
	let blocked = await personalBlock.setPersonalBlock(username, operator, TARGET, true)
	assert(blocked.includes(TARGET))
	let view = await materialize.getTimelineMaterialized(username, operator)
	assert(view.blocked?.includes(TARGET))

	blocked = await personalBlock.setPersonalBlock(username, operator, TARGET, false)
	assert(!blocked.includes(TARGET))
	view = await materialize.getTimelineMaterialized(username, operator)
	assert(!view.blocked?.includes(TARGET))
})

Deno.test('handleInboundPersonalBlockEvent syncs followed owner block index', async () => {
	const seed = randomSeed()
	const subject = pubKeyHash(publicKeyFromSeed(seed))
	const foreignOwner = encodeEntityHash('2'.repeat(64), subject)
	await seedRemoteTimeline(username, seed, foreignOwner, [
		{ type: 'social_meta', content: { isProtected: false, createdAt: 1 } },
		{ type: 'block', content: { targetEntityHash: TARGET } },
	])

	const append = await import('../src/timeline/append.mjs')
	const blockEv = (await append.readTimelineEvents(username, foreignOwner))
		.find(e => e.type === 'block')
	assert(blockEv)

	const followed = new Set([foreignOwner])
	await personalBlock.handleInboundPersonalBlockEvent(username, foreignOwner, blockEv, followed)
	const view = await materialize.getTimelineMaterialized(username, foreignOwner)
	assert(view.blocked?.includes(TARGET))
})

Deno.test('setPersonalHidden hides author from canViewPost', async () => {
	await setPersonalHidden(operator, TARGET, true)
	const viewerContext = await loadViewerContext(username)
	const post = {
		entityHash: TARGET,
		content: { text: 'hidden author post', visibility: 'public' },
	}
	assert(!canViewPost(post, viewerContext))
	await setPersonalHidden(operator, TARGET, false)
	const restored = await loadViewerContext(username)
	assert(canViewPost(post, restored))
})
