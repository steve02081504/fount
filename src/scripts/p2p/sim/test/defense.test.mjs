/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { evaluateTunables } from '../metrics.mjs'
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
	bundle.social.socialBlockClaim = 0
	bundle.social.socialRepHideThreshold = 0
	bundle.social.socialBlockDecayFraction = 0
	bundle.trustGraph.hintDefaultWeight = 0
	bundle.trustGraph.rosterDefaultScore = 0
	return bundle
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
