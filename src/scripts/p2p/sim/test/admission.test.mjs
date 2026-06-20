/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	capMaliciousByPowBudget,
	honestJoinDelayPenalty,
	roundsPerIdentity,
} from '../admission.mjs'

Deno.test('roundsPerIdentity grows with difficulty', () => {
	const low = roundsPerIdentity(16)
	const high = roundsPerIdentity(20)
	assertEquals(high > low, true)
})

Deno.test('capMaliciousByPowBudget limits sybil count', () => {
	const capped = capMaliciousByPowBudget(100, 18, 40)
	assertEquals(capped < 100, true)
	assertEquals(capped >= 1, true)
})

Deno.test('honestJoinDelayPenalty is bounded 0..1', () => {
	const p = honestJoinDelayPenalty(18, 40)
	assertEquals(p >= 0 && p <= 1, true)
})
