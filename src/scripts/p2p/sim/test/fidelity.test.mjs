/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { normalizeAttackGenome, randomAttackGenome } from '../attack_space.mjs'
import { fitnessFromSnapshot, evaluateTunablesAgainstAttacks, DEFAULT_WEIGHTS } from '../metrics.mjs'
import { runSimulation } from '../model.mjs'
import { createRng } from '../rng.mjs'
import { resolveScenarios } from '../scenarios.mjs'
import { defaultConcurrency, shutdownSimPool } from '../sim_pool.mjs'
import { loadDefaultTunables } from '../tunables_bundle.mjs'

const CASES = [
	{ scenarioId: 'balanced', seed: 1 },
	{ scenarioId: 'balanced', seed: 42 },
	{ scenarioId: 'sybil_heavy', seed: 3 },
	{ scenarioId: 'churn_storm', seed: 7 },
]

Deno.test('defaultConcurrency uses full logical CPU count', () => {
	const n = defaultConcurrency()
	let expected = 0
	if (typeof Deno !== 'undefined' && typeof Deno.systemCpuInfo === 'function') 
		try {
			expected = Math.max(expected, Deno.systemCpuInfo().cores ?? 0)
		}
		catch { /* ignore */ }
	
	const hw = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
	if (hw) expected = Math.max(expected, hw)
	expected = Math.max(1, expected || 4)
	assertEquals(n, expected)
})

Deno.test('runSimulation serial snapshots are deterministic', () => {
	const tunables = loadDefaultTunables()
	const scenario = resolveScenarios('balanced')[0]
	const a = runSimulation(scenario, 99, tunables)
	const b = runSimulation(scenario, 99, tunables)
	assertEquals(JSON.stringify(a), JSON.stringify(b))
})

Deno.test('parallel evaluate matches serial evaluate', async () => {
	const tunables = loadDefaultTunables()
	const scenario = resolveScenarios('balanced')[0]
	const seeds = [1, 2, 3]
	const attackPanel = [normalizeAttackGenome(undefined), randomAttackGenome(createRng(11))]

	const serial = await evaluateTunablesAgainstAttacks(
		[scenario], seeds, tunables, attackPanel, runSimulation, DEFAULT_WEIGHTS, { serial: true },
	)
	const parallel = await evaluateTunablesAgainstAttacks(
		[scenario], seeds, tunables, attackPanel, runSimulation, DEFAULT_WEIGHTS, { concurrency: 4 },
	)

	assertEquals(parallel.fitness, serial.fitness)
	assertEquals(parallel.mean, serial.mean)
	assertEquals(parallel.min, serial.min)
	assertEquals(parallel.max, serial.max)

	const sAgg = serial.byScenario[scenario.id]
	const pAgg = parallel.byScenario[scenario.id]
	assertEquals(pAgg.fitness, sAgg.fitness)
	for (let i = 0; i < sAgg.snapshots.length; i++)
		assertEquals(JSON.stringify(pAgg.snapshots[i]), JSON.stringify(sAgg.snapshots[i]))
})

Deno.test('parallel runSimulation jobs match direct runSimulation', async () => {
	const tunables = loadDefaultTunables()
	const attackGenome = randomAttackGenome(createRng(5))

	for (const { scenarioId, seed } of CASES) {
		const scenario = resolveScenarios(scenarioId)[0]
		const direct = runSimulation(scenario, seed, tunables, attackGenome)
		const evalResult = await evaluateTunablesAgainstAttacks(
			[scenario], [seed], tunables, [attackGenome], runSimulation, DEFAULT_WEIGHTS, { concurrency: 4 },
		)
		const viaEval = evalResult.byScenario[scenario.id].snapshots[0]
		assertEquals(fitnessFromSnapshot(viaEval, DEFAULT_WEIGHTS), fitnessFromSnapshot(direct, DEFAULT_WEIGHTS))
		assertEquals(JSON.stringify(viaEval), JSON.stringify(direct))
	}
})

Deno.test('teardown sim pool', () => {
	shutdownSimPool()
})
