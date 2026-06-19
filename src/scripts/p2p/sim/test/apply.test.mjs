/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { prepareBundleForApply } from '../apply.mjs'
import { clampBundleToSpace, PARAM_SPACE, randomCandidate } from '../space.mjs'

Deno.test('clampBundleToSpace keeps PARAM_SPACE values in bounds', () => {
	for (let seed = 1; seed <= 40; seed++) {
		const bundle = randomCandidate(seed)
		const clamped = clampBundleToSpace(bundle)
		for (const spec of PARAM_SPACE) {
			const v = clamped[spec.module][spec.key]
			assertEquals(v >= spec.min && v <= spec.max, true, `${spec.module}.${spec.key} seed ${seed}`)
			if (spec.kind === 'int')
				assertEquals(Number.isInteger(v), true, `${spec.module}.${spec.key} seed ${seed}`)
		}
	}
})

Deno.test('prepareBundleForApply preserves fractional tunables', () => {
	const bundle = randomCandidate(7)
	bundle.reputation.penaltyUnknownWant = 0.22
	bundle.reputation.slashDefaultClaim = 0.2
	bundle.social.socialRepHideThreshold = -0.4
	bundle.reputation.collusionDelta = 0.62

	const ready = prepareBundleForApply(bundle)
	assertEquals(ready.reputation.penaltyUnknownWant, 0.22)
	assertEquals(ready.reputation.slashDefaultClaim, 0.2)
	assertEquals(ready.social.socialRepHideThreshold, -0.4)
	assertEquals(ready.reputation.collusionDelta, 0.62)
})

Deno.test('prepareBundleForApply does not zero non-space reputation keys', () => {
	const bundle = randomCandidate(11)
	const ready = prepareBundleForApply(bundle)
	assertEquals(ready.reputation.slashDefaultClaim > 0, true)
	assertEquals(ready.reputation.slashUnverifiedDefaultClaim > 0, true)
	assertEquals(ready.reputation.chunkStoreRepBump > 0, true)
})
