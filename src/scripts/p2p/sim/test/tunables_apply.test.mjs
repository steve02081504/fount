/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { resolveArchiveQuorumPeerMin, resolveArchiveQuorumPeerStrictMin } from '../../tunables_resolve.mjs'
import { prepareBundleForApply } from '../apply.mjs'
import { normalizeBundle, PARAM_SPACE, randomCandidate, sanitizeArchiveQuorum } from '../space.mjs'

Deno.test('normalizeBundle keeps every PARAM_SPACE value in its semantic domain', () => {
	for (let seed = 1; seed <= 40; seed++) {
		const bundle = normalizeBundle(randomCandidate(seed))
		for (const spec of PARAM_SPACE) {
			const v = bundle[spec.module][spec.key]
			const label = `${spec.module}.${spec.key} seed ${seed}`
			assertEquals(Number.isFinite(v), true, label)
			if (spec.kind === 'count') assertEquals(Number.isInteger(v) && v >= 1, true, label)
			if (spec.kind === 'pos') assertEquals(v > 0, true, label)
			if (spec.kind === 'unit') assertEquals(v > 0 && v < 1, true, label)
			if (spec.kind === 'score') assertEquals(v > -1 && v < 1, true, label)
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

Deno.test('prepareBundleForApply enforces strict>=base quorum rule', () => {
	const bundle = randomCandidate(3)
	bundle.archive.archiveQuorumPeerMinRatio = 0.8
	bundle.archive.archiveQuorumPeerStrictMinRatio = 0.1
	sanitizeArchiveQuorum(bundle)
	const refN = 8
	assertEquals(
		resolveArchiveQuorumPeerStrictMin(refN, bundle.archive)
			>= resolveArchiveQuorumPeerMin(refN, bundle.archive),
		true,
	)
})
