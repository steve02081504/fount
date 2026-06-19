/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createRng } from '../rng.mjs'
import {
	domainRulePenalty,
	driftPenalty,
	normalizeParam,
	PARAM_SPACE,
	quantize,
	randomCandidate,
	sampleParam,
	softRulePenalty,
} from '../space.mjs'
import { loadDefaultTunables } from '../tunables_bundle.mjs'

Deno.test('quantize removes float tails', () => {
	assertEquals(quantize(0.060000000000000005, 6), 0.06)
	assertEquals(quantize(0.8400000000000001, 6), 0.84)
	assertEquals(String(quantize(0.034999999999999996, 6)).includes('999'), false)
})

Deno.test('quantize default preserves fractional values', () => {
	assertEquals(quantize(0.22), 0.22)
	assertEquals(quantize(-0.4), -0.4)
	assertEquals(quantize(0.62), 0.62)
})

Deno.test('sampleParam stays inside each semantic domain', () => {
	const rng = createRng(99)
	const base = loadDefaultTunables()
	for (const spec of PARAM_SPACE)
		for (let i = 0; i < 50; i++) {
			const v = sampleParam(rng, spec, base[spec.module][spec.key])
			const label = `${spec.module}.${spec.key}`
			assertEquals(Number.isFinite(v), true, label)
			switch (spec.kind) {
				case 'count':
					assertEquals(Number.isInteger(v) && v >= 1, true, label)
					break
				case 'pos':
					assertEquals(v > 0, true, label)
					break
				case 'unit':
					assertEquals(v > 0 && v < 1, true, label)
					break
				case 'score':
					assertEquals(v > -1 && v < 1, true, label)
					break
				default:
					break
			}
		}
})

Deno.test('normalizeParam repairs out-of-domain values without a tuning box', () => {
	assertEquals(normalizeParam(-5, { module: 'reputation', key: 'penaltyUnknownWant', kind: 'pos' }) > 0, true)
	assertEquals(normalizeParam(3.4, { module: 'social', key: 'socialBlockClaim', kind: 'unit' }) < 1, true)
	assertEquals(normalizeParam(2.7, { module: 'mailbox', key: 'maxHop', kind: 'count' }), 3)
	assertEquals(normalizeParam(9, { module: 'social', key: 'socialRepHideThreshold', kind: 'score' }) < 1, true)
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

Deno.test('softRulePenalty is zero at defaults', () => {
	const base = loadDefaultTunables()
	assertEquals(softRulePenalty(base) < 1e-9, true)
	assertEquals(driftPenalty(base) < 1e-9, true)
	assertEquals(domainRulePenalty(base) < 1e-9, true)
})

Deno.test('driftPenalty grows as a param leaves its default', () => {
	const near = loadDefaultTunables()
	near.reputation.penaltyUnknownWant *= 1.5
	const far = loadDefaultTunables()
	far.reputation.penaltyUnknownWant *= 6
	assertEquals(driftPenalty(far) > driftPenalty(near), true)
	assertEquals(driftPenalty(near) > 0, true)
})

Deno.test('domain rules discourage gutting defenses and trigger-happy hiding', () => {
	const weak = loadDefaultTunables()
	weak.reputation.penaltyUnknownWant = 0.001
	weak.reputation.penaltyMessageRate = 0.001
	assertEquals(domainRulePenalty(weak) > 0.2, true)

	const triggerHappy = loadDefaultTunables()
	triggerHappy.social.socialRepHideThreshold = -0.05
	assertEquals(domainRulePenalty(triggerHappy) > 0, true)
})

Deno.test('fanout soft band discourages both collapse and bloat', () => {
	const base = loadDefaultTunables()
	const tooLow = loadDefaultTunables()
	tooLow.trustGraph.federationFanoutTopK = Math.max(1, Math.round(base.trustGraph.federationFanoutTopK / 4))
	const tooHigh = loadDefaultTunables()
	tooHigh.trustGraph.federationFanoutTopK = base.trustGraph.federationFanoutTopK * 4
	assertEquals(domainRulePenalty(tooLow) > 0, true)
	assertEquals(domainRulePenalty(tooHigh) > 0, true)
})
