/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	blendArchiveQuorumAccuracy,
	integrityDefendsAgainst,
	observerHasLocalReplica,
	replicaObserverFraction,
} from '../integrity.mjs'

const archiveScenario = {
	honestCount: 10,
	groupSize: 12,
	behaviorDist: { archiveSubmitRate: { mean: 0.2 } },
}

Deno.test('observerHasLocalReplica requires honest majority and anchor or archive-heavy', () => {
	assertEquals(observerHasLocalReplica({ trustedPeers: ['a'] }, archiveScenario), true)
	assertEquals(observerHasLocalReplica({ trustedPeers: [] }, archiveScenario), false)
	assertEquals(observerHasLocalReplica(
		{ trustedPeers: ['a', 'b'] },
		{ honestCount: 2, groupSize: 12, behaviorDist: { archiveSubmitRate: { mean: 0.2 } } },
	), true)
	assertEquals(observerHasLocalReplica(
		{ trustedPeers: [] },
		{ honestCount: 2, groupSize: 12, behaviorDist: { archiveSubmitRate: { mean: 0.2 } } },
	), false)
})

Deno.test('integrityDefendsAgainst archive_forger with verified forgery', () => {
	const attacker = { id: 'm1', attack: 'archive_forger' }
	const observer = { id: 'o1', trustedPeers: ['t1', 't2'] }
	const scenario = { honestCount: 10, groupSize: 12, behaviorDist: { archiveSubmitRate: { mean: 0.2 } } }
	const ctx = { verifiedForgery: new Set(['m1']) }
	assertEquals(integrityDefendsAgainst(attacker, observer, scenario, ctx), true)
})

Deno.test('blendArchiveQuorumAccuracy weights replica observers', () => {
	const blended = blendArchiveQuorumAccuracy(0.4, 0.6)
	assertEquals(blended > 0.4, true)
	assertEquals(blended <= 1, true)
	assertEquals(Math.abs(blended - 0.45) < 1e-9, true)
})

Deno.test('replicaObserverFraction counts observers with replicas', () => {
	const scenario = {
		honestCount: 10,
		groupSize: 12,
		behaviorDist: { archiveSubmitRate: { mean: 0.2 } },
	}
	const observers = [
		{ trustedPeers: ['a'] },
		{ trustedPeers: [] },
	]
	assertEquals(replicaObserverFraction(observers, scenario), 0.5)
})
