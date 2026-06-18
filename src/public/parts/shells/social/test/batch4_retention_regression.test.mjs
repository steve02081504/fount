/**
 * Batch 4：retention 与连通分支不变量。
 * 远端时间线为连通链时，runSocialTimelineMaintenance（每次 materialize 触发）不得丢帖。
 * （脱链事件 prev_event_ids=[] 会被 enforceTimelineEventRetention 按共识分支裁掉——见 README。）
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { bootstrap, randomSeed, seedRemoteTimeline } from './harness.mjs'

const { username } = await bootstrap()
const materialize = await import('../src/timeline/materialize.mjs')
const { pubKeyHash, publicKeyFromSeed } = await import('../../../../../scripts/p2p/crypto.mjs')
const { encodeEntityHash } = await import('../../../../../scripts/p2p/entity_id.mjs')

Deno.test('chained ingest survives retention across repeated materialize', async () => {
	const seed = randomSeed()
	const subject = pubKeyHash(publicKeyFromSeed(seed))
	const remoteOwner = encodeEntityHash('9'.repeat(64), subject)
	await seedRemoteTimeline(username, seed, remoteOwner, [
		{ type: 'social_meta', content: { isProtected: false, createdAt: 1 } },
		{ type: 'post', content: { text: 'remote authored', visibility: 'public' } },
		{ type: 'post', content: { text: 'second post', visibility: 'public' } },
	])

	const v1 = await materialize.getTimelineMaterialized(username, remoteOwner)
	const v2 = await materialize.getTimelineMaterialized(username, remoteOwner)
	assertEquals(v1.posts.length, 2, 'first materialize sees both posts')
	assertEquals(v2.posts.length, 2, 'repeated materialize keeps connected branch (no retention loss)')
})
