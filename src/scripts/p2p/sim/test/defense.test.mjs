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
 * 仅看仿真指标的适应度（全部内生，无外生规则惩罚）。
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
 * @type {Array<[string, string, number, number]>} module, key, 低值, 高值
 */
const GRADIENT_GUARDS = [
	['reputation', 'slashVerifiedMultiplier', 0.02, 0.95],
	['reputation', 'introducerSeedEdge', 0.02, 0.95],
	['reputation', 'wantUnknownThreshold', 1, 12],
	['reputation', 'collusionMaxHop', 1, 8],
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
		const scenarios = resolveScenarios('all')
		let delta = 0
		for (const scenario of scenarios)
			for (const seed of [1, 2, 3])
				delta += Math.abs(
					fitnessFromSnapshot(runSimulation(scenario, seed, lowBundle))
					- fitnessFromSnapshot(runSimulation(scenario, seed, highBundle)),
				)
		assertEquals(delta > 1e-6, true, `${module}.${key} flat: delta=${delta}`)
	})

Deno.test('gutted fanout loses fitness on churn_storm (endogenous resilience)', () => {
	const base = loadDefaultTunables()
	const lean = loadDefaultTunables()
	lean.mailbox.relayFanoutTrusted = 1
	lean.mailbox.wantFanout = 1
	lean.mailbox.maxHop = 1
	lean.trustGraph.federationFanoutTopK = 1

	const scenario = resolveScenarios('churn_storm')[0]
	let baseFit = 0
	let leanFit = 0
	for (const seed of [1, 2, 3, 4, 5]) {
		baseFit += fitnessFromSnapshot(runSimulation(scenario, seed, base))
		leanFit += fitnessFromSnapshot(runSimulation(scenario, seed, lean))
	}

	assertEquals(
		leanFit < baseFit,
		true,
		`lean fitness ${leanFit} should be below base ${baseFit}`,
	)
})

Deno.test('strictMin=1 loses archiveQuorum on digest_equivocation (endogenous byzantine)', () => {
	const strict = loadDefaultTunables()
	strict.archive.archiveQuorumPeerMin = 1
	strict.archive.archiveQuorumPeerStrictMin = 1

	const safe = loadDefaultTunables()
	safe.archive.archiveQuorumPeerMin = 2
	safe.archive.archiveQuorumPeerStrictMin = 2

	const scenario = resolveScenarios('digest_equivocation')[0]
	const strictSnap = runSimulation(scenario, 7, strict)
	const safeSnap = runSimulation(scenario, 7, safe)

	assertEquals(
		strictSnap.archiveQuorumAccuracy < safeSnap.archiveQuorumAccuracy,
		true,
		`strict ${strictSnap.archiveQuorumAccuracy} should be below safe ${safeSnap.archiveQuorumAccuracy}`,
	)
})

Deno.test('key_thief and sleeper are containable on dedicated scenarios', () => {
	const tunables = loadDefaultTunables()
	const keySnap = runSimulation(resolveScenarios('key_compromise')[0], 4, tunables)
	const sleeperSnap = runSimulation(resolveScenarios('sleeper_turn')[0], 4, tunables)

	assertEquals(keySnap.compromiseContainmentRate > 0, true)
	assertEquals(sleeperSnap.sleeperReactionRate >= 0, true)
})

Deno.test('trigger-happy hide threshold raises falsePositive (endogenous mis-hide)', () => {
	const base = loadDefaultTunables()
	const triggerHappy = loadDefaultTunables()
	triggerHappy.social.socialRepHideThreshold = -0.05

	const scenario = resolveScenarios('balanced')[0]
	const baseSnap = runSimulation(scenario, 9, base)
	const happySnap = runSimulation(scenario, 9, triggerHappy)

	assertEquals(
		happySnap.falsePositiveRate >= baseSnap.falsePositiveRate,
		true,
		`happy ${happySnap.falsePositiveRate} should be >= base ${baseSnap.falsePositiveRate}`,
	)
})
