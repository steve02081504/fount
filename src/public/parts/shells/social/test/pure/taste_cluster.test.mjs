/**
 * 口味聚类与 for_you 打分纯函数测试。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { isTimelineEventVisibleForFederation } from '../../src/federation/visibility.mjs'
import { scorePostForYou } from '../../src/feed/ranking.mjs'
import { pickClusterRepresentative } from '../../src/taste/cluster.mjs'
import { weightedJaccard } from '../../src/taste/jaccard.mjs'
import { pruneClaimInbox } from '../../src/taste/mergeClaims.mjs'
import { verifyTagMergeClaimWithStats } from '../../src/taste/mergeVerify.mjs'
import { normalizeTasteStore, resolveTasteAlias, tasteWeightOf } from '../../src/taste/store.mjs'

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

Deno.test('resolveTasteAlias stops on cycles', () => {
	const aliases = {
		a: { to: 'b', confidence: 1 },
		b: { to: 'a', confidence: 1 },
	}
	assertEquals(resolveTasteAlias('a', aliases), 'a')
})

Deno.test('normalizeTasteStore migrates legacy tags into computed', () => {
	const store = normalizeTasteStore({
		tags: { t1: 3 },
		privacy: { publishPreferences: false },
	})
	assertEquals(store.computed.t1, 3)
	assertEquals(store.privacy.publishPreferences, false)
	assertEquals(store.privacy.publishReactions, true)
	assertEquals(tasteWeightOf(store, 't1'), 3)
})

Deno.test('tasteWeightOf sums computed and manual', () => {
	const store = normalizeTasteStore({
		computed: { t1: 2 },
		manual: { t1: -1 },
	})
	assertEquals(tasteWeightOf(store, 't1'), 1)
})

Deno.test('verifyTagMergeClaimWithStats rejects low usage', () => {
	const stats = {
		usage: new Map([['from', 1], ['to', 5]]),
		audiences: new Map([
			['from', new Map([['r1', 1]])],
			['to', new Map([['r1', 1], ['r2', 1]])],
		]),
	}
	const result = verifyTagMergeClaimWithStats(stats, { from: 'from', to: 'to' })
	assertEquals(result.ok, false)
	assertEquals(result.reason, 'usage')
})

Deno.test('verifyTagMergeClaimWithStats accepts good fit', () => {
	const shared = new Map([['r1', 1], ['r2', 1], ['r3', 1]])
	const stats = {
		usage: new Map([['from', 3], ['to', 3]]),
		audiences: new Map([
			['from', shared],
			['to', new Map(shared)],
		]),
	}
	const result = verifyTagMergeClaimWithStats(stats, { from: 'from', to: 'to' })
	assert(result.ok)
	assert(result.confidence > 0)
})

Deno.test('scorePostForYou higher with tasteMatch than without', () => {
	const now = Date.now()
	const post = { id: 'p1', entityHash: 'author', hlc: { wall: now } }
	const engagement = {
		likes: new Map(),
		dislikes: new Map(),
		reposts: new Map(),
		replies: new Map(),
	}
	const base = scorePostForYou(post, engagement, 0, 0, now)
	const boosted = scorePostForYou(post, engagement, 0, 4, now)
	assert(boosted > base)
})

Deno.test('scorePostForYou demotes on negative tasteMatch', () => {
	const now = Date.now()
	const post = { id: 'p1', entityHash: 'author', hlc: { wall: now } }
	const engagement = {
		likes: new Map(),
		dislikes: new Map(),
		reposts: new Map(),
		replies: new Map(),
	}
	const base = scorePostForYou(post, engagement, 0, 0, now)
	const demoted = scorePostForYou(post, engagement, 0, -4, now)
	assert(demoted < base)
})

Deno.test('federation exports reactions only when publishReactions', () => {
	const event = { type: 'like', content: {} }
	/** @returns {boolean} 恒真 */
	const canView = () => true
	assertEquals(isTimelineEventVisibleForFederation(event, 'owner', {
		publishReactions: true,
		isOwner: false,
		hideFromDiscovery: false,
		followsOwner: false,
		requesterEntityHash: null,
	}, canView), true)
	assertEquals(isTimelineEventVisibleForFederation(event, 'owner', {
		publishReactions: false,
		isOwner: false,
		hideFromDiscovery: false,
		followsOwner: false,
		requesterEntityHash: null,
	}, canView), false)
})

Deno.test('federation exports tag_name only when publishPreferences', () => {
	const event = { type: 'tag_name', content: { tagHash: 't', locale: 'zh-CN', label: '猫' } }
	/** @returns {boolean} 恒真 */
	const canView = () => true
	assertEquals(isTimelineEventVisibleForFederation(event, 'owner', {
		publishPreferences: true,
		publishReactions: true,
		isOwner: false,
		hideFromDiscovery: false,
		followsOwner: false,
		requesterEntityHash: null,
	}, canView), true)
	assertEquals(isTimelineEventVisibleForFederation(event, 'owner', {
		publishPreferences: false,
		publishReactions: true,
		isOwner: false,
		hideFromDiscovery: false,
		followsOwner: false,
		requesterEntityHash: null,
	}, canView), false)
})
