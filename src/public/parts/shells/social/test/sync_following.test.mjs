/**
 * following 薄层：无 following.json，从时间线物化读取。
 */
/* global Deno */
import { assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'

Deno.test('following.mjs reads from timeline materialize not JSON sidecar', async () => {
	const url = new URL('../src/following.mjs', import.meta.url)
	const text = await Deno.readTextFile(url)
	assert(!text.includes('following.json'))
	assert(text.includes('getTimelineMaterialized'))
	assert(text.includes('p2p/social/follower_index.mjs'))
})

Deno.test('follower index lives in p2p social layer', async () => {
	const url = new URL('../../../../../scripts/p2p/social/follower_index.mjs', import.meta.url)
	const text = await Deno.readTextFile(url)
	assert(text.includes('listReplicaUsernamesFollowing'))
	assert(text.includes('follower_index'))
	assert(text.includes('followerEntryCache'))
	assert(!text.includes('legacyPath'))
})
