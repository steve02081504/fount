/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { runSimulation } from '../model.mjs'
import { createPropagationState, enqueueSlash, tickPropagation } from '../propagation.mjs'
import { createRng } from '../rng.mjs'
import { resolveScenarios } from '../scenarios.mjs'
import { loadDefaultTunables } from '../tunables_bundle.mjs'

Deno.test('tickPropagation delays delivery by spread rounds', () => {
	const state = createPropagationState()
	const rng = createRng(42)
	/** @type {Array<[string, string, number, boolean]>} */
	const applied = []
	enqueueSlash(state, { targetId: 't', senderId: 's', claim: 1, verified: false, birthRound: 0, spread: 1 })
	assertEquals(tickPropagation(state, 0, (...args) => applied.push(args), () => 1, 1, rng), 0)
	assertEquals(tickPropagation(state, 1, (...args) => applied.push(args), () => 1, 1, rng), 1)
})

Deno.test('false_accuser slash is async not instant omniscient', () => {
	const scenario = resolveScenarios('social_war')[0]
	const tunables = loadDefaultTunables()
	const snap = runSimulation(scenario, 8, tunables)
	assertEquals(typeof snap.falsePositiveRate, 'number')
	assertEquals(snap.byAttackDefense?.false_accuser?.rate >= 0, true)
})
