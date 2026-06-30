/* global Deno */
import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { isQuietHonestBehavior, sampleBehavior, BEHAVIOR_KEYS } from '../behavior.mjs'
import { runSimulation } from '../model.mjs'
import { createRng } from '../rng.mjs'
import { resolveScenarios } from '../scenarios.mjs'
import { loadDefaultTunables } from '../tunables_bundle.mjs'

Deno.test('sampleBehavior produces 9-dim vector in [0,1]', () => {
	const rng = createRng(99)
	const b = sampleBehavior(rng)
	for (const key of BEHAVIOR_KEYS) 
		assert(b[key] >= 0 && b[key] <= 1, key)
	
})

Deno.test('isQuietHonestBehavior detects low-post high-like users', () => {
	assert(isQuietHonestBehavior({
		postRate: 0.05, likeRate: 0.6, replyRate: 0.1,
		relayRate: 0.2, chunkServeRate: 0.1, onlineStability: 0.9,
		blockProneness: 0.05, archiveSubmitRate: 0.05, mentionRate: 0.05,
	}))
	assertEquals(isQuietHonestBehavior({
		postRate: 0.5, likeRate: 0.6, replyRate: 0.1,
		relayRate: 0.2, chunkServeRate: 0.1, onlineStability: 0.9,
		blockProneness: 0.05, archiveSubmitRate: 0.05, mentionRate: 0.05,
	}), false)
})

Deno.test('quiet_honest scenario preserves silent users', () => {
	const tunables = loadDefaultTunables()
	const scenario = resolveScenarios('quiet_honest')[0]
	const snap = runSimulation(scenario, 11, tunables)
	assertEquals(typeof snap.quietHonestPreservationRate, 'number')
	assert(snap.quietHonestPreservationRate >= 0.5, 'quiet users should mostly survive')
})
