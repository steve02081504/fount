/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { runSimulation } from '../model.mjs'
import { resolveScenarios } from '../scenarios.mjs'
import {
	createTransportState,
	takeTransportJoinSlot,
	transportHintWeight,
	transportMetrics,
} from '../transport.mjs'
import { loadDefaultTunables } from '../tunables_bundle.mjs'

Deno.test('single source can still connect at least one peer', () => {
	const state = createTransportState()
	state.rtcMaxActive = 8
	state.maxJoinsPerMin = 120
	assertEquals(takeTransportJoinSlot(state, 'peer0', 'solo-source', 1000), true)
	const sourceCap = Math.max(1, Math.floor(state.rtcMaxActive * 0.25))
	for (let i = 1; i < sourceCap; i++)
		assertEquals(takeTransportJoinSlot(state, `peer${i}`, 'solo-source', 1000 + i), true)
})

Deno.test('transport_siege scenario exposes transport metrics', () => {
	const snap = runSimulation(resolveScenarios('transport_siege')[0], 3, loadDefaultTunables())
	assertEquals(typeof snap.transportReachRate, 'number')
	assertEquals(typeof snap.joinThrottleEffectiveness, 'number')
	assertEquals(snap.transportReachRate >= 0 && snap.transportReachRate <= 1, true)
})

Deno.test('transportMetrics tracks signaling diversity', () => {
	const state = createTransportState()
	transportHintWeight(state, 'obs', 'p1', 'tracker')
	transportHintWeight(state, 'obs', 'p2', 'nostr')
	const m = transportMetrics(state, 'obs', ['obs', 'p1', 'p2'], () => 0.5)
	assertEquals(m.reach >= 0 && m.reach <= 1, true)
	assertEquals(m.diversity > 0, true)
})
