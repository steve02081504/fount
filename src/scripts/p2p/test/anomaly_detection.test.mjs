/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import reputationTunables from '../reputation.tunables.json' with { type: 'json' }
import { ensureReputationShape, isQuarantinedPure, observeBehaviorSamplePure } from '../reputation_engine.mjs'

Deno.test('observeBehaviorSamplePure triggers quarantine after baseline drift', () => {
	const data = ensureReputationShape({ byNodeHash: {}, wantUnknownHits: [], relayBumpSeen: [] })
	const peer = 'b'.repeat(64)
	const tunables = { ...reputationTunables, baselineMinSamples: 4, anomalyZThreshold: 1.5 }
	let anomaly = false
	for (let i = 0; i < 6; i++)
		observeBehaviorSamplePure(data, peer, 0.05, 1000 + i, tunables)
	anomaly = observeBehaviorSamplePure(data, peer, 2.5, 2000, tunables).anomaly
	assertEquals(anomaly, true)
	assertEquals(isQuarantinedPure(data, peer, 2000), true)
})
