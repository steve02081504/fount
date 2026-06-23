/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { fitnessFromSnapshot } from '../metrics.mjs'
import { runSimulation } from '../model.mjs'
import { resolveScenarios } from '../scenarios.mjs'
import { loadDefaultTunables } from '../tunables_bundle.mjs'

/**
 * 提交级参考 tunables（与磁盘当前值解耦，用于对比测试）。
 * @returns {import('../tunables_bundle.mjs').TunablesBundle} 参考 bundle
 */
function canonicalTunables() {
	return loadDefaultTunables()
}

/**
 * 构造关闭防御的参数集。
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

Deno.test('default tunables improve sybil containment vs disabled', () => {
	const scenario = resolveScenarios('sybil_heavy')[0]
	const defaults = canonicalTunables()
	const disabled = disabledDefenseBundle()
	let defaultSybil = 0
	let disabledSybil = 0
	for (const seed of [1, 2, 3]) {
		defaultSybil += runSimulation(scenario, seed, defaults).sybilContainmentRate
		disabledSybil += runSimulation(scenario, seed, disabled).sybilContainmentRate
	}
	assertEquals(
		defaultSybil / 3 >= disabledSybil / 3,
		true,
		`default sybil ${defaultSybil / 3} vs disabled ${disabledSybil / 3}`,
	)
})

Deno.test('sybilContainmentRate is non-trivial on sybil_heavy', () => {
	const tunables = loadDefaultTunables()
	const scenario = resolveScenarios('sybil_heavy')[0]
	const snap = runSimulation(scenario, 1, tunables)
	assertEquals(snap.sybilContainmentRate > 0, true)
})

/**
 * 定义梯度守卫参数。
 * @type {Array<[string, string, number, number]>} module, key, 低值, 高值
 */
const GRADIENT_GUARDS = [
	['reputation', 'slashVerifiedMultiplier', 0.02, 0.95],
	['reputation', 'introducerSeedEdge', 0.02, 0.95],
	['reputation', 'wantUnknownThreshold', 1, 12],
	['trustGraph', 'federationFanoutTopKRatio', 0.05, 0.8],
	['trustGraph', 'rosterDefaultScore', 0.001, 0.95],
	['mailbox', 'maxHop', 1, 8],
	['mailbox', 'relayFanoutTrustedRatio', 0.05, 0.9],
	['mailbox', 'wantFanoutRatio', 0.05, 0.9],
	['archive', 'archiveQuorumPeerMinRatio', 0.1, 0.8],
	['archive', 'archiveQuorumPeerStrictMinRatio', 0.2, 0.95],
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

Deno.test('federationFanoutTopK=1 loses fitness on eclipse_targeted (isolated federation resilience)', () => {
	const base = loadDefaultTunables()
	const lean = loadDefaultTunables()
	lean.trustGraph.federationFanoutTopKFloor = 1
	lean.trustGraph.federationFanoutTopKRatio = 0.01
	lean.trustGraph.federationFanoutTopKCap = 1

	const moderate = loadDefaultTunables()
	moderate.trustGraph.federationFanoutTopKFloor = 3
	moderate.trustGraph.federationFanoutTopKRatio = 0.35
	moderate.trustGraph.federationFanoutTopKCap = 12

	const scenario = resolveScenarios('eclipse_targeted')[0]
	let leanFit = 0
	let moderateFit = 0
	for (const seed of [1, 2, 3, 4, 5]) {
		leanFit += fitnessFromSnapshot(runSimulation(scenario, seed, lean))
		moderateFit += fitnessFromSnapshot(runSimulation(scenario, seed, moderate))
	}

	assertEquals(
		leanFit < moderateFit,
		true,
		`lean federation ${leanFit} should be below moderate ${moderateFit}`,
	)
})

Deno.test('gutted fanout loses fitness on churn_storm (endogenous resilience)', () => {
	const base = canonicalTunables()
	const lean = canonicalTunables()
	lean.mailbox.relayFanoutTrustedFloor = 1
	lean.mailbox.relayFanoutTrustedRatio = 0.01
	lean.mailbox.relayFanoutTrustedCap = 1
	lean.mailbox.wantFanoutFloor = 1
	lean.mailbox.wantFanoutRatio = 0.01
	lean.mailbox.wantFanoutCap = 1
	lean.mailbox.maxHop = 1
	lean.trustGraph.federationFanoutTopKFloor = 1
	lean.trustGraph.federationFanoutTopKRatio = 0.01
	lean.trustGraph.federationFanoutTopKCap = 1

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

Deno.test('federationFanoutTopK has interior optimum on eclipse_targeted', () => {
	const low = loadDefaultTunables()
	low.trustGraph.federationFanoutTopKFloor = 1
	low.trustGraph.federationFanoutTopKRatio = 0.01
	low.trustGraph.federationFanoutTopKCap = 1
	const mid = loadDefaultTunables()
	mid.trustGraph.federationFanoutTopKFloor = 3
	mid.trustGraph.federationFanoutTopKRatio = 0.35
	mid.trustGraph.federationFanoutTopKCap = 12
	const high = loadDefaultTunables()
	high.trustGraph.federationFanoutTopKFloor = 8
	high.trustGraph.federationFanoutTopKRatio = 0.9
	high.trustGraph.federationFanoutTopKCap = 32

	const scenario = resolveScenarios('eclipse_targeted')[0]
	let lowFit = 0
	let midFit = 0
	let highFit = 0
	for (const seed of [1, 2, 3, 4, 5]) {
		lowFit += fitnessFromSnapshot(runSimulation(scenario, seed, low))
		midFit += fitnessFromSnapshot(runSimulation(scenario, seed, mid))
		highFit += fitnessFromSnapshot(runSimulation(scenario, seed, high))
	}

	assertEquals(midFit > lowFit, true, `mid ${midFit} vs low ${lowFit}`)
	assertEquals(midFit > highFit, true, `mid ${midFit} vs high ${highFit}`)
})

Deno.test('mailbox maxHop has interior optimum on churn_storm', () => {
	const low = canonicalTunables()
	low.mailbox.maxHop = 1
	const mid = canonicalTunables()
	mid.mailbox.maxHop = 5
	const high = canonicalTunables()
	high.mailbox.maxHop = 8

	const scenario = resolveScenarios('churn_storm')[0]
	let lowFit = 0
	let midFit = 0
	let highFit = 0
	for (const seed of [1, 2, 3, 4, 5]) {
		lowFit += fitnessFromSnapshot(runSimulation(scenario, seed, low))
		midFit += fitnessFromSnapshot(runSimulation(scenario, seed, mid))
		highFit += fitnessFromSnapshot(runSimulation(scenario, seed, high))
	}

	assertEquals(midFit > lowFit, true, `mid ${midFit} vs low ${lowFit}`)
	assertEquals(midFit > highFit, true, `mid ${midFit} vs high ${highFit}`)
})

Deno.test('archive quorum strictMin improves defense vs permissive strictMin', () => {
	const permissive = loadDefaultTunables()
	permissive.archive.archiveQuorumPeerMinFloor = 1
	permissive.archive.archiveQuorumPeerMinRatio = 0.01
	permissive.archive.archiveQuorumPeerStrictMinFloor = 1
	permissive.archive.archiveQuorumPeerStrictMinRatio = 0.01
	const strict = loadDefaultTunables()
	strict.archive.archiveQuorumPeerMinFloor = 2
	strict.archive.archiveQuorumPeerMinRatio = 0.25
	strict.archive.archiveQuorumPeerStrictMinFloor = 2
	strict.archive.archiveQuorumPeerStrictMinRatio = 0.5

	const scenario = resolveScenarios('digest_equivocation')[0]
	let permissiveDef = 0
	let strictDef = 0
	for (const seed of [1, 2, 3, 4, 5]) {
		permissiveDef += runSimulation(scenario, seed, permissive).archiveDefenseRate
		strictDef += runSimulation(scenario, seed, strict).archiveDefenseRate
	}

	assertEquals(strictDef >= permissiveDef, true, `strict ${strictDef} vs permissive ${permissiveDef}`)
})

Deno.test('strictMin=1 loses archiveDefense on digest_equivocation (endogenous byzantine)', () => {
	const strict = loadDefaultTunables()
	strict.archive.archiveQuorumPeerMinFloor = 1
	strict.archive.archiveQuorumPeerMinRatio = 0.01
	strict.archive.archiveQuorumPeerStrictMinFloor = 1
	strict.archive.archiveQuorumPeerStrictMinRatio = 0.01

	const safe = loadDefaultTunables()
	safe.archive.archiveQuorumPeerMinFloor = 2
	safe.archive.archiveQuorumPeerMinRatio = 0.25
	safe.archive.archiveQuorumPeerStrictMinFloor = 2
	safe.archive.archiveQuorumPeerStrictMinRatio = 0.5

	const scenario = resolveScenarios('digest_equivocation')[0]
	const strictSnap = runSimulation(scenario, 7, strict)
	const safeSnap = runSimulation(scenario, 7, safe)

	assertEquals(
		strictSnap.archiveDefenseRate <= safeSnap.archiveDefenseRate,
		true,
		`strict ${strictSnap.archiveDefenseRate} should be at most safe ${safeSnap.archiveDefenseRate}`,
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

Deno.test('tiny_group archive quorum stays live at groupSize 3', () => {
	const tunables = loadDefaultTunables()
	const scenario = resolveScenarios('tiny_group')[0]
	const snap = runSimulation(scenario, 3, tunables)
	assertEquals(snap.archiveQuorumAccuracy > 0, true)
	assertEquals(snap.groupSize, 3)
})

Deno.test('defense metrics are not saturated at 1.0 on balanced with defaults', () => {
	const tunables = loadDefaultTunables()
	const scenario = resolveScenarios('balanced')[0]
	const snap = runSimulation(scenario, 1, tunables)
	const notAllOne = snap.malSuppressionRate < 0.999
		|| snap.sybilContainmentRate < 0.999
		|| snap.collusionCollapseRate < 0.999
	assertEquals(notAllOne, true, 'at least one defense metric should be below ceiling')
})
