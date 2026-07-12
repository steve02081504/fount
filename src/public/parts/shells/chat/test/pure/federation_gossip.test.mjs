/**
 * 联邦 gossip 纯函数单测。
 */
/* global Deno */
import {
	batchWantIds,
	wantIdsPeerKey,
} from 'npm:@steve02081504/fount-p2p/federation/want_ids'
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	buildGossipForwardPlan,
	takeGossipRequestSlot,
	wantIdsLimitsFromSettings,
} from '../../src/chat/federation/gossip.mjs'
import { shouldPreferJoinSnapshot } from '../../src/chat/federation/staleResync.mjs'

Deno.test('wantIdsLimitsFromSettings derives batch from budget', () => {
	const limits = wantIdsLimitsFromSettings({ wantIdsBudget: 64 })
	assertEquals(limits.inMaxBatch, 64)
	assertEquals(limits.outMaxBatch, 64)
})

Deno.test('batchWantIds uses settings-derived outbound budget', () => {
	const limits = wantIdsLimitsFromSettings({ wantIdsBudget: 12 })
	const wantIds = Array.from({ length: 30 }, (_, i) => `id-${i}`)
	const batched = batchWantIds(wantIds, limits.outMaxBatch)
	assertEquals(batched.length, 12)
	assertEquals(batched[0], 'id-0')
	assertEquals(batched[11], 'id-11')
})

Deno.test('wantIdsPeerKey encodes group and peer for gossip dedupe', () => {
	const key = wantIdsPeerKey('group-abc', 'peer-def')
	assertEquals(key.includes('\0'), true)
	assertEquals(key, 'group-abc\0peer-def')
})

Deno.test('takeGossipRequestSlot dedupes repeated keys', () => {
	const key = 'peer:want:abc'
	assertEquals(takeGossipRequestSlot(key), true)
	assertEquals(takeGossipRequestSlot(key), false)
})

Deno.test('buildGossipForwardPlan decrements ttl', () => {
	const plan = buildGossipForwardPlan({
		wantIds: ['a'.repeat(64)],
		ttl: 3,
		requesterNodeHash: 'b'.repeat(64),
		archiveSummary: null,
		attestation: null,
	}, { gossipTtl: 5 })
	assert(plan)
	assertEquals(plan.forwardPayload.ttl, 2)
})

Deno.test('buildGossipForwardPlan returns null when ttl exhausted', () => {
	assertEquals(buildGossipForwardPlan({
		wantIds: [], ttl: 0, requesterNodeHash: 'b'.repeat(64),
	}, { gossipTtl: 2 }), null)
})

Deno.test('shouldPreferJoinSnapshot when tipsHash mismatch', () => {
	const local = 'a'.repeat(64)
	assert(shouldPreferJoinSnapshot(local, [{ tipsHash: 'b'.repeat(64) }]))
	assertEquals(shouldPreferJoinSnapshot(local, [{ tipsHash: local }]), false)
})
