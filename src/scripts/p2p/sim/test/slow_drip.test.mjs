/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { runSimulation } from '../model.mjs'
import { resolveScenarios } from '../scenarios.mjs'
import { loadDefaultTunables } from '../tunables_bundle.mjs'

Deno.test('slow_drip_spam is deterministic across runs', () => {
	const scenario = resolveScenarios('slow_drip_spam')[0]
	const tunables = loadDefaultTunables()
	const a = runSimulation(scenario, 42, tunables)
	const b = runSimulation(scenario, 42, tunables)
	assertEquals(JSON.stringify(a), JSON.stringify(b))
})

Deno.test('slow_drip_spam defends better than disabled penalties', () => {
	const scenario = resolveScenarios('slow_drip_spam')[0]
	const defaults = loadDefaultTunables()
	const disabled = loadDefaultTunables()
	disabled.reputation.penaltyMessageRate = 0
	let defaultDefense = 0
	let disabledDefense = 0
	for (const seed of [1, 2, 3]) {
		defaultDefense += runSimulation(scenario, seed, defaults).byAttackDefense?.slow_drip_spammer?.rate ?? 0
		disabledDefense += runSimulation(scenario, seed, disabled).byAttackDefense?.slow_drip_spammer?.rate ?? 0
	}
	assertEquals(defaultDefense / 3 >= disabledDefense / 3, true)
})
