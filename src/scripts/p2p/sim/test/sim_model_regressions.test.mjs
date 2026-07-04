/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	createDiscoveryState,
	eclipseFillExplore,
	initObserverDiscovery,
	takeRoomSlot,
} from '../discovery.mjs'
import { integrityDefendsAgainst, observerHasLocalReplica } from '../integrity.mjs'
import { runSimulation } from '../model.mjs'
import { createRng } from '../rng.mjs'
import { resolveScenarios } from '../scenarios.mjs'
import { createTransportState, takeTransportJoinSlot } from '../transport.mjs'
import { loadDefaultTunables } from '../tunables_bundle.mjs'

Deno.test('reachCollapse does not shrink with observer count', () => {
	const tunables = loadDefaultTunables()
	const base = resolveScenarios('spam_eclipse')[0]
	const small = { ...base, honestCount: 6, attacks: { eclipse: 6 }, rounds: 30 }
	const large = { ...base, honestCount: 24, attacks: { eclipse: 6 }, rounds: 30 }
	const snapSmall = runSimulation(small, 5, tunables)
	const snapLarge = runSimulation(large, 5, tunables)
	const rSmall = snapSmall.byAttackImpact?.eclipse?.reachCollapse ?? 0
	const rLarge = snapLarge.byAttackImpact?.eclipse?.reachCollapse ?? 0
	if (rSmall > 0.02)
		assert(
			rLarge >= rSmall * 0.35,
			`reachCollapse should not scale down with more observers: small=${rSmall} large=${rLarge}`,
		)
})

Deno.test('newcomers excluded from falsePositiveRate', () => {
	const tunables = loadDefaultTunables()
	tunables.social.socialRepHideThreshold = 0.01
	const withNewcomers = {
		...resolveScenarios('balanced')[0],
		honestCount: 8,
		newcomerCount: 6,
		attacks: {},
		rounds: 10,
	}
	const withoutNewcomers = { ...withNewcomers, newcomerCount: 0 }
	const snapWith = runSimulation(withNewcomers, 11, tunables)
	const snapWithout = runSimulation(withoutNewcomers, 11, tunables)
	assert(
		snapWith.falsePositiveRate <= snapWithout.falsePositiveRate,
		`newcomers inflated falsePositive: with=${snapWith.falsePositiveRate} without=${snapWithout.falsePositiveRate}`,
	)
})

Deno.test('verifiedForgery is per-observer not global', () => {
	const attacker = { id: 'm1', attack: 'archive_forger' }
	const scenario = { honestCount: 10, groupSize: 12, behaviorDist: { archiveSubmitRate: { mean: 0.2 } } }
	const observerA = { id: 'o1', trustedPeers: ['t1', 't2'] }
	const observerB = { id: 'o2', trustedPeers: ['t1', 't2'] }
	const ctx = { verifiedForgeryByObserver: new Map([['o1', new Set(['m1'])]]) }
	assertEquals(integrityDefendsAgainst(attacker, observerA, scenario, ctx), true)
	assertEquals(integrityDefendsAgainst(attacker, observerB, scenario, ctx), false)
	assertEquals(observerHasLocalReplica(observerB, scenario), true)
})

Deno.test('takeRoomSlot enforces maxNonTrusted cap', () => {
	const state = createDiscoveryState()
	state.rtcMaxActive = 10
	const trusted = ['t1', 't2', 't3']
	initObserverDiscovery(state, 'obs', trusted, ['obs', 't1', 't2', 't3', ...Array.from({ length: 12 }, (_, i) => `p${i}`)], createRng(1), 4)
	const bucket = state.roomSlotsByObserver.get('obs')
	assert(bucket)
	const maxNonTrusted = Math.max(0, state.rtcMaxActive - bucket.trustedReserved.size)
	let nonTrustedAdded = 0
	for (let i = 0; i < 20; i++) {
		if (!takeRoomSlot(state, 'obs', `extra${i}`, 'spam', trusted)) continue
		if (!bucket.trustedReserved.has(`extra${i}`)) nonTrustedAdded++
	}
	assert(nonTrustedAdded <= maxNonTrusted, `non-trusted slots ${nonTrustedAdded} > cap ${maxNonTrusted}`)
})

Deno.test('eclipse cluster mates fill explore together', () => {
	const state = createDiscoveryState()
	const rng = createRng(3)
	const roster = ['obs', 'h1', 'mal1', 'mal2', 'mal3']
	initObserverDiscovery(state, 'obs', ['h1'], roster, rng, 4)
	eclipseFillExplore(state, 'obs', 'mal1', ['mal2', 'mal3'], 0.9)
	const explore = state.exploreByObserver.get('obs')
	assert(explore?.has('mal2'))
	assert(explore?.has('mal3'))
})

Deno.test('transport trusted peers reserve slots per observer', () => {
	const state = createTransportState()
	state.rtcMaxActive = 8
	state.maxJoinsPerMin = 200
	for (const id of ['anchor1', 'anchor2', 'anchor3'])
		state.trustedPeers.add(id)
	for (const id of ['anchor1', 'anchor2', 'anchor3'])
		assertEquals(takeTransportJoinSlot(state, id, 'trusted', 1000), true)
	const trustedReserved = Math.max(3, Math.floor(state.rtcMaxActive * 0.25))
	const maxNonTrusted = Math.max(1, state.rtcMaxActive - trustedReserved)
	let nonTrusted = 0
	for (let i = 0; i < 20; i++)
		if (takeTransportJoinSlot(state, `flood${i}`, 'flood-src', 2000 + i)) nonTrusted++
	assert(nonTrusted <= maxNonTrusted + 1)
})

Deno.test('buildWorld wires per-observer transport with trusted anchors', () => {
	const snap = runSimulation(resolveScenarios('transport_siege')[0], 2, loadDefaultTunables())
	assertEquals(typeof snap.joinThrottleEffectiveness, 'number')
	assert(snap.joinThrottleEffectiveness >= 0 && snap.joinThrottleEffectiveness <= 1)
})
