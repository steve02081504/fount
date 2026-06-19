/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createRng } from '../rng.mjs'
import {
	bandwidthCost,
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

Deno.test('defaults carry a bounded intrinsic cost (rules are NOT default-anchored)', () => {
	const base = loadDefaultTunables()
	// 关键反例：默认值不再是「零惩罚」中心；它也要为自身的带宽规模等内在成本付费。
	const penaltyAtDefault = softRulePenalty(base)
	assertEquals(penaltyAtDefault > 0, true)
	assertEquals(penaltyAtDefault < 0.3, true)
})

Deno.test('intrinsic rules let a strictly-cheaper-bandwidth candidate beat the default', () => {
	const base = loadDefaultTunables()
	const lean = loadDefaultTunables()
	lean.mailbox.relayFanoutTrusted = Math.max(1, base.mailbox.relayFanoutTrusted - 2)
	lean.mailbox.wantFanout = Math.max(1, base.mailbox.wantFanout - 2)
	// 带宽更省 → 内在惩罚更低（旧 drift 规则会因「偏离默认」反而惩罚它，这正是要消除的偏置）。
	assertEquals(bandwidthCost(lean) < bandwidthCost(base), true)
	assertEquals(softRulePenalty(lean) < softRulePenalty(base), true)
})

Deno.test('defense floor is absolute, not relative to current default', () => {
	const gutted = loadDefaultTunables()
	gutted.reputation.penaltyUnknownWant = 0.001
	gutted.reputation.penaltyMessageRate = 0.001
	assertEquals(softRulePenalty(gutted) > softRulePenalty(loadDefaultTunables()) + 0.2, true)

	// 把默认值「下移」后再评估同一个 0.001：惩罚不应随默认值改变（绝对锚定）。
	const strong = loadDefaultTunables()
	strong.reputation.penaltyUnknownWant = 0.001
	const weakAnchor = loadDefaultTunables()
	weakAnchor.reputation.penaltyUnknownWant = 0.001
	assertEquals(softRulePenalty(strong), softRulePenalty(weakAnchor))
})

Deno.test('quorum and hide rules are one-sided absolute knees', () => {
	const base = loadDefaultTunables()
	const bigQuorum = loadDefaultTunables()
	bigQuorum.archive.archiveQuorumPeerStrictMin = 9
	assertEquals(softRulePenalty(bigQuorum) > softRulePenalty(base), true)

	const triggerHappy = loadDefaultTunables()
	triggerHappy.social.socialRepHideThreshold = -0.05
	assertEquals(softRulePenalty(triggerHappy) > softRulePenalty(base), true)
})
