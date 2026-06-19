/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { computeProgressPercent } from '../optimizer.mjs'
import { downsampleHistory } from '../report.mjs'

Deno.test('computeProgressPercent clamps', () => {
	assertEquals(computeProgressPercent(1000, 20, 5, 500, true), 50)
	assertEquals(computeProgressPercent(1000, 20, 5, 1500, true), 100)
	assertEquals(computeProgressPercent(null, 20, 10, 0, false), 50)
	assertEquals(computeProgressPercent(null, 20, 25, 0, false), 100)
})

Deno.test('downsampleHistory caps rows', () => {
	const history = Array.from({ length: 200 }, (_, i) => ({
		generation: i,
		bestFitness: 0.4 + i * 0.001,
		meanFitness: 0.3,
	}))
	const out = downsampleHistory(history, 60)
	assertEquals(out.length <= 60, true)
	assertEquals(out[0].generation, 0)
	assertEquals(out[out.length - 1].generation, 199)
})
