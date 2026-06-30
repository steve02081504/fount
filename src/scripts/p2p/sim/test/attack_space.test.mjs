/* global Deno */
import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	mutateAttackGenome,
	normalizeAttackGenome,
	randomAttackGenome,
	resolveAttackParams,
	updateAttackHallOfFame,
} from '../attack_space.mjs'
import { createRng } from '../rng.mjs'

Deno.test('randomAttackGenome and mutate are deterministic with seed', () => {
	const rng1 = createRng(7)
	const g1 = randomAttackGenome(rng1)
	const rng2 = createRng(7)
	const g2 = randomAttackGenome(rng2)
	assertEquals(g1.global.activationRate, g2.global.activationRate)
	const child = mutateAttackGenome(g1, 99)
	assert(child.global.burstSize >= 1)
})

Deno.test('resolveAttackParams merges global and per-attack overrides', () => {
	const genome = normalizeAttackGenome({
		global: { activationRate: 0.5, burstSize: 3, targetBiasHighRep: 0.2, eclipseFocus: 0.6 },
		byAttack: { sybil: { activationRate: 0.9 } },
	})
	const p = resolveAttackParams('sybil', genome)
	assertEquals(p.activationRate, 0.9)
	assertEquals(p.burstSize, 3)
})

Deno.test('attack hall of fame keeps top fitness', () => {
	const genome = normalizeAttackGenome(undefined)
	let hof = updateAttackHallOfFame([], genome, 0.5)
	hof = updateAttackHallOfFame(hof, { ...genome, global: { ...genome.global, burstSize: 9 } }, 0.9)
	assert(hof.length >= 1)
	assertEquals(hof[0].fitness, 0.9)
})
