/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	computeRepMaxEff,
	REP_MAX_EFF_EPS,
	subjectiveSlashPenalty,
} from '../reputation_math.mjs'

Deno.test('computeRepMaxEff only uses positive trust anchors', () => {
	const withPositive = computeRepMaxEff({
		byNodeHash: {
			a: { score: -0.8 },
			b: { score: 0 },
			c: { score: 0.62 },
		},
	})
	assertEquals(withPositive, 0.62)

	const allNonPositive = computeRepMaxEff({
		byNodeHash: {
			a: { score: -0.8 },
			b: { score: 0 },
		},
	})
	assertEquals(allNonPositive, REP_MAX_EFF_EPS)
})

Deno.test('subjectiveSlashPenalty ignores negative sender reputation', () => {
	const unverifiedBadSender = subjectiveSlashPenalty(0.5, -0.9, 1, false)
	assertEquals(unverifiedBadSender, 0)

	const unverifiedGoodSender = subjectiveSlashPenalty(0.5, 0.9, 1, false)
	assertEquals(unverifiedGoodSender > 0, true)

	const verifiedPenalty = subjectiveSlashPenalty(0.5, -0.9, 1, true)
	assertEquals(verifiedPenalty > 0, true)
})
