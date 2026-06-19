/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { fitnessFromSnapshot, RATE_METRIC_KEYS } from '../metrics.mjs'
import { runSimulation } from '../model.mjs'
import { resolveScenarios } from '../scenarios.mjs'
import { loadDefaultTunables } from '../tunables_bundle.mjs'

Deno.test('p2p sim smoke', () => {
	const tunables = loadDefaultTunables()
	const scenario = resolveScenarios('balanced')[0]
	const snap = runSimulation(scenario, 1, tunables)

	for (const key of RATE_METRIC_KEYS) {
		assertEquals(typeof snap[key], 'number', key)
		assertEquals(snap[key] >= 0 && snap[key] <= 1, true, key)
	}

	assertEquals(typeof snap.malSuppressionRate, 'number')
	assertEquals(typeof snap.honestPreservationRate, 'number')
	assertEquals(snap.malSuppressionRate >= 0 && snap.malSuppressionRate <= 1, true)
	assertEquals(snap.honestPreservationRate >= 0 && snap.honestPreservationRate <= 1, true)

	const fitness = fitnessFromSnapshot(snap)
	assertEquals(Number.isFinite(fitness), true)
})

Deno.test('usage_mix scenario profiles', () => {
	const tunables = loadDefaultTunables()
	const scenario = resolveScenarios('usage_mix')[0]
	const snap = runSimulation(scenario, 7, tunables)
	assertEquals(snap.profilePreservationRate >= 0, true)
	assertEquals(snap.relayPreservationRate >= 0, true)
})
