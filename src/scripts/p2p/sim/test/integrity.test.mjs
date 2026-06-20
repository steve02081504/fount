/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	blendArchiveQuorumAccuracy,
	integrityDefendsAgainst,
	observerHasLocalReplica,
	replicaObserverFraction,
} from '../integrity.mjs'

Deno.test('observerHasLocalReplica when honest share high or trusted peers', () => {
	const scenario = { honestCount: 10, groupSize: 12 }
	assertEquals(observerHasLocalReplica({ trustedPeers: [] }, scenario), true)
	assertEquals(observerHasLocalReplica({ trustedPeers: ['a', 'b'] }, { honestCount: 2, groupSize: 12 }), true)
	assertEquals(observerHasLocalReplica({ trustedPeers: [] }, { honestCount: 2, groupSize: 12 }), false)
})

Deno.test('integrityDefendsAgainst archive_forger with local replica', () => {
	const attacker = { id: 'm1', attack: 'archive_forger' }
	const observer = { id: 'o1', trustedPeers: ['t1', 't2'] }
	const scenario = { honestCount: 8, groupSize: 8 }
	assertEquals(integrityDefendsAgainst(attacker, observer, scenario, {}), true)
})

Deno.test('blendArchiveQuorumAccuracy weights replica observers', () => {
	const blended = blendArchiveQuorumAccuracy(0.4, 0.5)
	assertEquals(blended > 0.4, true)
	assertEquals(blended <= 1, true)
})

Deno.test('replicaObserverFraction counts observers with replicas', () => {
	const scenario = { honestCount: 4, groupSize: 12 }
	const observers = [
		{ trustedPeers: ['a', 'b'] },
		{ trustedPeers: [] },
	]
	assertEquals(replicaObserverFraction(observers, scenario), 0.5)
})
