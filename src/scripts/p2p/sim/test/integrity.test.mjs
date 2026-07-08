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
	const simulationContext = { verifiedForgeryByObserver: new Map([['o1', new Set(['m1'])]]) }
	assertEquals(integrityDefendsAgainst(attacker, observer, scenario, simulationContext), true)
})

Deno.test('blendArchiveQuorumAccuracy weights replica observers', () => {
	const blended = blendArchiveQuorumAccuracy(0.4, 0.6)
	assertEquals(blended, 0.51)
	assertEquals(blendArchiveQuorumAccuracy(0.2, 1), 0.85)
	assertEquals(blendArchiveQuorumAccuracy(0.9, 0.5), 0.9)
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
