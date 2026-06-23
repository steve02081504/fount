/**
 * retention 与连通分支不变量。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { randomSeed, seedRemoteTimeline } from '../federation/remote_timeline.mjs'
import { createTestSession } from '../harness.mjs'

const getSession = createTestSession()
const materialize = await import('../../src/timeline/materialize.mjs')
const { pubKeyHash, publicKeyFromSeed } = await import('fount/scripts/p2p/crypto.mjs')
const { encodeEntityHash } = await import('fount/scripts/p2p/entity_id.mjs')

Deno.test('chained ingest survives retention across repeated materialize', async () => {
	const { username } = await getSession()
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
