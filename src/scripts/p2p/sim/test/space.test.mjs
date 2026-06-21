/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createRng } from '../rng.mjs'
import {
	normalizeParam,
	PARAM_SPACE,
	quantize,
	randomCandidate,
	sampleParam,
	sanitizeArchiveQuorum,
} from '../space.mjs'
import { resolveArchiveQuorumPeerMin, resolveArchiveQuorumPeerStrictMin } from '../../tunables_resolve.mjs'
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
		sanitizeArchiveQuorum(bundle)
		const refN = 8
		assertEquals(
			resolveArchiveQuorumPeerStrictMin(refN, bundle.archive)
				>= resolveArchiveQuorumPeerMin(refN, bundle.archive),
			true,
			`seed ${seed}`,
		)
	}
})
