/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	adjustNodeReputation,
	bumpReputationOnRelayPure,
	computeRecidivismMultiplier,
	defaultReputationTunables,
	ensureReputationShape,
	penalizeArchiveServeMismatchPure,
	pruneReputationFile,
	recordMessageRateViolationPure,
} from '../reputation_engine.mjs'

const tunables = defaultReputationTunables()
const PEER = 'a'.repeat(64)

Deno.test('computeRecidivismMultiplier escalates with streak', () => {
	assertEquals(computeRecidivismMultiplier(1, tunables), 1.25)
	assertEquals(computeRecidivismMultiplier(4, tunables), 2)
	assertEquals(computeRecidivismMultiplier(100, tunables), tunables.recidivismMax)
})

Deno.test('repeat penalties escalate within window', () => {
	const data = ensureReputationShape({ byNodeHash: {}, wantUnknownHits: [], relayBumpSeen: [] })
	const t0 = 1_000_000
	adjustNodeReputation(data, PEER, -0.1, t0, tunables)
	const first = data.byNodeHash[PEER].score
	adjustNodeReputation(data, PEER, -0.1, t0 + 1000, tunables)
	const second = data.byNodeHash[PEER].score
	assertEquals(first, -0.125)
	assertEquals(second, first - 0.1 * 1.5)
	assertEquals(data.byNodeHash[PEER].offenseStreak, 2)
})

Deno.test('offense streak resets after window expires', () => {
	const data = ensureReputationShape({ byNodeHash: {}, wantUnknownHits: [], relayBumpSeen: [] })
	const t0 = 1_000_000
	adjustNodeReputation(data, PEER, -0.1, t0, tunables)
	adjustNodeReputation(data, PEER, -0.1, t0 + tunables.recidivismWindowMs + 1, tunables)
	assertEquals(data.byNodeHash[PEER].offenseStreak, 1)
})

Deno.test('pruneReputationFile clears expired offense streak', () => {
	const data = ensureReputationShape({
		byNodeHash: {
			[PEER]: { score: -0.5, offenseStreak: 3, lastOffenseAt: 1000 },
		},
		wantUnknownHits: [],
		relayBumpSeen: [],
	})
	pruneReputationFile(data, tunables, 1000 + tunables.recidivismWindowMs + 1)
	assertEquals(data.byNodeHash[PEER].offenseStreak, undefined)
	assertEquals(data.byNodeHash[PEER].lastOffenseAt, undefined)
})

Deno.test('bumpReputationOnRelay preserves socialBlocks and offense fields', () => {
	const data = ensureReputationShape({
		byNodeHash: {
			[PEER]: {
				score: 0.2,
				offenseStreak: 2,
				lastOffenseAt: 5000,
				socialBlocks: { voter: { penalty: 0.1, appliedAt: 4000 } },
			},
		},
		wantUnknownHits: [],
		relayBumpSeen: [],
	})
	bumpReputationOnRelayPure(data, PEER, 'k1', 6000, tunables)
	const row = data.byNodeHash[PEER]
	assertEquals(row.score > 0.2, true)
	assertEquals(row.offenseStreak, 2)
	assertEquals(row.lastOffenseAt, 5000)
	assertEquals(row.socialBlocks?.voter?.penalty, 0.1)
})

Deno.test('penalize and message rate use recidivism via adjustNodeReputation', () => {
	const data = ensureReputationShape({ byNodeHash: {}, wantUnknownHits: [], relayBumpSeen: [] })
	const t0 = 2_000_000
	recordMessageRateViolationPure(data, PEER, tunables)
	const afterFirst = data.byNodeHash[PEER].score
	data.byNodeHash[PEER].lastOffenseAt = t0
	data.byNodeHash[PEER].offenseStreak = 1
	penalizeArchiveServeMismatchPure(data, PEER, tunables)
	const afterSecond = data.byNodeHash[PEER].score
	assertEquals(afterSecond < afterFirst - tunables.archiveServeMismatchPenalty, true)
})
