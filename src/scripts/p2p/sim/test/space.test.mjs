/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createRng } from '../rng.mjs'
import { PARAM_SPACE, quantize, randomCandidate, sampleParam } from '../space.mjs'

Deno.test('quantize removes float tails', () => {
	assertEquals(quantize(0.060000000000000005, 0.01, 0.05), 0.06)
	assertEquals(quantize(0.8400000000000001, 0.02, 0.4), 0.84)
	assertEquals(String(quantize(0.034999999999999996, 0.005, 0.005)).includes('999'), false)
})

Deno.test('quantize without step preserves fractional values', () => {
	assertEquals(quantize(0.22), 0.22)
	assertEquals(quantize(-0.4), -0.4)
	assertEquals(quantize(0.62), 0.62)
	assertEquals(quantize(0.2), 0.2)
})

Deno.test('sampleParam respects int and float specs', () => {
	const rng = createRng(99)
	for (const spec of PARAM_SPACE) 
		for (let i = 0; i < 20; i++) {
			const v = sampleParam(rng, spec)
			assertEquals(v >= spec.min && v <= spec.max, true, `${spec.module}.${spec.key}`)
			if (spec.kind === 'int')
				assertEquals(Number.isInteger(v), true, `${spec.module}.${spec.key}`)
			else if (spec.step)
				assertEquals(String(v).replace(/-?\d+\./, '.').includes('00000000000'), false, `${spec.module}.${spec.key}`)
		}
	
})

Deno.test('randomCandidate archive quorum ordering', () => {
	for (let seed = 1; seed <= 30; seed++) {
		const bundle = randomCandidate(seed)
		assertEquals(
			bundle.archive.archiveQuorumPeerStrictMin >= bundle.archive.archiveQuorumPeerMin,
			true,
			`seed ${seed}`,
		)
	}
})
