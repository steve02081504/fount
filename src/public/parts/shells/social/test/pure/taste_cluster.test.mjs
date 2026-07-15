/**
 * 口味聚类与 for_you 打分纯函数测试。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { weightedJaccard, pickClusterRepresentative } from '../../src/taste/cluster.mjs'
import { pruneClaimInbox } from '../../src/taste/mergeClaims.mjs'
import { scorePostForYou } from '../../src/feed/ranking.mjs'

Deno.test('weightedJaccard measures overlap', () => {
	const left = new Map([['a', 1], ['b', 2]])
	const right = new Map([['a', 1], ['c', 2]])
	const score = weightedJaccard(left, right)
	assert(score > 0 && score < 1)
	assertEquals(weightedJaccard(new Map(), right), 0)
})

Deno.test('pickClusterRepresentative prefers senior reactors', () => {
	const junior = new Map([['r1', 1]])
	const senior = new Map([['r1', 1], ['r2', 1]])
	const audiences = [junior, senior, senior, junior]
	const rep = pickClusterRepresentative(audiences)
	assertEquals(rep, 'r1')
})

Deno.test('pruneClaimInbox drops expired rows', () => {
	const now = Date.now()
	const rows = pruneClaimInbox([
		{ at: now - 8 * 24 * 60 * 60 * 1000, claim: { from: 'a', to: 'b' }, sourceNodeHash: 's1' },
		{ at: now, claim: { from: 'c', to: 'd' }, sourceNodeHash: 's2' },
	])
	assertEquals(rows.length, 1)
	assertEquals(rows[0].claim.from, 'c')
})

Deno.test('scorePostForYou higher with tasteMatch than without', () => {
	const now = Date.now()
	const post = { id: 'p1', entityHash: 'author', hlc: { wall: now } }
	const engagement = {
		likes: new Map(),
		reposts: new Map(),
		replies: new Map(),
	}
	const base = scorePostForYou(post, engagement, 0, 0, now)
	const boosted = scorePostForYou(post, engagement, 0, 4, now)
	assert(boosted > base)
})
