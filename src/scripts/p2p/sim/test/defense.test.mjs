/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { evaluateTunables, fitnessFromSnapshot } from '../metrics.mjs'
import { runSimulation } from '../model.mjs'
import { resolveScenarios } from '../scenarios.mjs'
import { loadDefaultTunables } from '../tunables_bundle.mjs'

/**
 * @returns {import('../tunables_bundle.mjs').TunablesBundle} 关停防御的作弊 bundle
 */
function disabledDefenseBundle() {
	const bundle = loadDefaultTunables()
	bundle.reputation.penaltyUnknownWant = 0
	bundle.reputation.penaltyMessageRate = 0
	bundle.reputation.chunkFetchFailPenalty = 0
	bundle.reputation.archiveServeMismatchPenalty = 0
	bundle.reputation.relayRepBump = 0
	bundle.reputation.collusionLambda = 0
	bundle.reputation.slashDefaultClaim = 0
	bundle.reputation.slashVerifiedDefaultClaim = 0
	bundle.reputation.slashUnverifiedDefaultClaim = 0
	bundle.reputation.slashVerifiedMultiplier = 0
	bundle.reputation.introducerSeedEdge = 1
	bundle.social.socialBlockClaim = 0
	bundle.social.socialRepHideThreshold = 0
	bundle.social.socialBlockDecayFraction = 0
	bundle.trustGraph.hintDefaultWeight = 0
	bundle.trustGraph.rosterDefaultScore = 0
	return bundle
}

/**
 * 仅看仿真指标的适应度（剔除规则惩罚），用于隔离「某参数是否真的影响仿真」。
 * @param {import('../tunables_bundle.mjs').TunablesBundle} bundle tunables
 * @param {number[]} [seeds] 种子
 * @returns {number} 全场景平均的快照适应度
 */
function simOnlyFitness(bundle, seeds = [1, 2, 3]) {
	const scenarios = resolveScenarios('all')
	let total = 0
	let n = 0
	for (const scenario of scenarios)
		for (const seed of seeds) {
			total += fitnessFromSnapshot(runSimulation(scenario, seed, bundle))
			n++
		}
	return total / Math.max(1, n)
}

Deno.test('default tunables beat disabled-defense bundle on balanced', async () => {
	const scenarios = resolveScenarios('balanced')
	const seeds = [1, 2, 3]
	const defaults = loadDefaultTunables()
	const disabled = disabledDefenseBundle()

	const defaultResult = await evaluateTunables(scenarios, seeds, defaults, runSimulation)
	const disabledResult = await evaluateTunables(scenarios, seeds, disabled, runSimulation)

	assertEquals(
		defaultResult.fitness >= disabledResult.fitness,
		true,
		`default ${defaultResult.fitness} vs disabled ${disabledResult.fitness}`,
	)
})

Deno.test('sybilContainmentRate is non-trivial on sybil_heavy', () => {
	const tunables = loadDefaultTunables()
	const scenario = resolveScenarios('sybil_heavy')[0]
	const snap = runSimulation(scenario, 1, tunables)
	assertEquals(snap.sybilContainmentRate > 0, true)
})

/**
 * 每个「曾经在仿真里没有梯度」的参数，现在都必须能改变全场景仿真适应度。
 * 这是防回归守卫：若未来某次改动让某参数重新变成「死参数」，本测试会失败。
 * @type {Array<[string, string, number, number]>} module, key, 低值, 高值
 */
const GRADIENT_GUARDS = [
	['reputation', 'slashVerifiedMultiplier', 0.02, 0.95],
	['reputation', 'introducerSeedEdge', 0.02, 0.95],
	['reputation', 'wantUnknownThreshold', 1, 12],
	['reputation', 'collusionMaxHop', 1, 8],
	['trustGraph', 'hintMaxBonus', 0.001, 0.95],
	['trustGraph', 'rosterDefaultScore', 0.001, 0.95],
	['archive', 'archiveQuorumPeerMin', 1, 6],
	['archive', 'archiveQuorumPeerStrictMin', 2, 9],
]

for (const [module, key, low, high] of GRADIENT_GUARDS)
	Deno.test(`param ${module}.${key} has a live simulation gradient`, () => {
		const lowBundle = loadDefaultTunables()
		lowBundle[module][key] = low
		const highBundle = loadDefaultTunables()
		highBundle[module][key] = high
		const delta = Math.abs(simOnlyFitness(lowBundle) - simOnlyFitness(highBundle))
		assertEquals(delta > 1e-6, true, `${module}.${key} flat: delta=${delta}`)
	})
