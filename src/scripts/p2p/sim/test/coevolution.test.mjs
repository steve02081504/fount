/* global Deno */
import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { runCoevolution } from '../coevolution.mjs'
import { minPanelFitness } from '../metrics.mjs'
import { resolveScenarios } from '../scenarios.mjs'

Deno.test('runCoevolution returns blue and red champions', async () => {
	const scenarios = resolveScenarios('balanced').slice(0, 1)
	const result = await runCoevolution({
		scenarios,
		generations: 2,
		population: 4,
		redPopulation: 3,
		seeds: [1],
		seedBase: 100,
	})
	assert(result.best.result.fitness >= 0)
	assert(result.bestRed.attackGenome?.global?.burstSize >= 1)
	assert(Array.isArray(result.attackHof))
	assert(result.history.length >= 2)
})

Deno.test('minPanelFitness tracks worst scenario min', () => {
	const byScenario = {
		a: { min: 0.8, fitness: 0.8, mean: 0.8, max: 0.8, std: 0, snapshots: [] },
		b: { min: 0.3, fitness: 0.5, mean: 0.5, max: 0.5, std: 0, snapshots: [] },
	}
	assertEquals(minPanelFitness(byScenario), 0.3)
})
