/**
 * 个人 block / hide 写路径。
 */
/* global Deno */
import { placeholderEntityHash } from 'fount/scripts/test/fixtures.mjs'
import { assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { setPersonalHidden } from 'npm:@steve02081504/fount-p2p/node/personal_block'

import { randomSeed, seedRemoteTimeline } from '../federation/remote_timeline.mjs'
import { createTestSession } from '../harness.mjs'

const getSession = createTestSession()

const personalBlock = await import('../../src/personalBlock.mjs')
const materialize = await import('../../src/timeline/materialize.mjs')
const { loadViewerContext } = await import('../../src/feed/home.mjs')
const { canViewPost } = await import('../../src/feedVisibility.mjs')
const { pubKeyHash, publicKeyFromSeed } = await import('npm:@steve02081504/fount-p2p/crypto')
const { encodeEntityHash } = await import('npm:@steve02081504/fount-p2p/core/entity_id')

const TARGET = placeholderEntityHash('b')

Deno.test('setPersonalBlock block then unblock updates materialized blocked', async () => {
	const { username, operator } = await getSession()
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
	const { username } = await getSession()
	const seed = randomSeed()
	const subject = pubKeyHash(publicKeyFromSeed(seed))
	const foreignOwner = encodeEntityHash('2'.repeat(64), subject)
	await seedRemoteTimeline(username, seed, foreignOwner, [
		{ type: 'social_meta', content: { hideFromDiscovery: false, createdAt: 1 } },
		{ type: 'block', content: { targetEntityHash: TARGET } },
	])

	const append = await import('../../src/timeline/append.mjs')
	const blockEv = (await append.readTimelineEvents(username, foreignOwner))
		.find(e => e.type === 'block')
	assert(blockEv)

	const followed = new Set([foreignOwner])
	await personalBlock.handleInboundPersonalBlockEvent(username, foreignOwner, blockEv, followed)
	const view = await materialize.getTimelineMaterialized(username, foreignOwner)
	assert(view.blocked?.includes(TARGET))
})

Deno.test('setPersonalHidden hides author from canViewPost', async () => {
	const { username, operator } = await getSession()
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
