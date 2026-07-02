/* global Deno */
import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	createDiscoveryState,
	discoveryReach,
	eclipseFillExplore,
	initObserverDiscovery,
	recoverDiscoveryFromAnchors,
} from '../discovery.mjs'
import { runSimulation } from '../model.mjs'
import { createRng } from '../rng.mjs'
import { resolveScenarios } from '../scenarios.mjs'
import { loadDefaultTunables } from '../tunables_bundle.mjs'

Deno.test('discoveryReach uses trusted anchors', () => {
	const state = createDiscoveryState()
	const rng = createRng(1)
	const roster = ['a', 'b', 'c', 'd', 'e']
	initObserverDiscovery(state, 'obs', ['a', 'b'], roster, rng, 4)
	const reach = discoveryReach(state, 'obs', roster, () => 1, 3)
	assert(reach > 0.4)
})

Deno.test('eclipseFillExplore poisons explore set', () => {
	const state = createDiscoveryState()
	const rng = createRng(2)
	const roster = ['obs', 'h1', 'h2', 'h3', 'mal1', 'mal2']
	initObserverDiscovery(state, 'obs', ['h1'], roster, rng, 4)
	eclipseFillExplore(state, 'obs', 'mal1', ['mal2'], 0.8)
	const explore = state.exploreByObserver.get('obs')
	assert(explore?.has('mal1'))
	assert(state.poisonedByAttacker.get('obs')?.has('mal1'))
})

Deno.test('recoverDiscoveryFromAnchors clears poison', () => {
	const state = createDiscoveryState()
	state.trustedAnchorsByObserver.set('obs', new Set(['h1']))
	state.poisonedByAttacker.set('obs', new Set(['mal1']))
	recoverDiscoveryFromAnchors(state, 'obs')
	assertEquals(state.poisonedByAttacker.has('obs'), false)
})

Deno.test('trustedAnchors are per-observer not shared', () => {
	const state = createDiscoveryState()
	const rng = createRng(99)
	const roster = ['obs1', 'obs2', 'a', 'b', 'c', 'd']
	initObserverDiscovery(state, 'obs1', ['a', 'b'], roster, rng, 2)
	initObserverDiscovery(state, 'obs2', ['c', 'd'], roster, createRng(100), 2)
	assertEquals(state.trustedAnchorsByObserver.get('obs1')?.has('a'), true)
	assertEquals(state.trustedAnchorsByObserver.get('obs1')?.has('c'), false)
	assertEquals(state.trustedAnchorsByObserver.get('obs2')?.has('c'), true)
	assertEquals(state.trustedAnchorsByObserver.get('obs2')?.has('a'), false)
})

Deno.test('eclipse scenario produces byAttackImpact reach data', () => {
	const snap = runSimulation(resolveScenarios('spam_eclipse')[0], 5, loadDefaultTunables())
	assert(typeof snap.byAttackImpact?.eclipse?.reachCollapse === 'number')
})

Deno.test('reachCollapse attributed only to reach-type attacks', () => {
	const snap = runSimulation(resolveScenarios('spam_eclipse')[0], 5, loadDefaultTunables())
	const eclipseReach = snap.byAttackImpact?.eclipse?.reachCollapse ?? 0
	const sybilReach = snap.byAttackImpact?.sybil?.reachCollapse ?? 0
	assertEquals(sybilReach, 0)
	assertEquals(eclipseReach > 0, true, 'spam_eclipse must produce measurable reach collapse')
	assertEquals(eclipseReach > sybilReach, true)
})
