/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	adjustNodeReputation,
	bumpReputationOnRelayPure,
	computeRecidivismMultiplier,
	defaultReputationTunables,
	ensureReputationShape,
	incrementBadInviteeCount,
	pruneReputationFile,
} from '../../reputation_engine.mjs'

const tunables = defaultReputationTunables()
const PEER = 'a'.repeat(64)

Deno.test('computeRecidivismMultiplier escalates with streak', () => {
	const step = tunables.recidivismMultiplierStep
	assertEquals(computeRecidivismMultiplier(1, tunables), 1 + step)
	assertEquals(computeRecidivismMultiplier(4, tunables), Math.min(tunables.recidivismMax, 1 + step * 4))
	assertEquals(computeRecidivismMultiplier(100, tunables), tunables.recidivismMax)
})

Deno.test('repeat penalties escalate without time window reset', () => {
	const data = ensureReputationShape({ byNodeHash: {}, wantUnknownHits: [], relayBumpSeen: [] })
	const t0 = 1_000_000
	const delta = 0.1
	adjustNodeReputation(data, PEER, -delta, t0, tunables)
	const first = data.byNodeHash[PEER].score
	const secondMult = computeRecidivismMultiplier(2, tunables)
	adjustNodeReputation(data, PEER, -delta, t0 + 86_400_000, tunables)
	const second = data.byNodeHash[PEER].score
	assertEquals(first, -delta * computeRecidivismMultiplier(1, tunables))
	assertEquals(second, first - delta * secondMult)
	assertEquals(data.byNodeHash[PEER].offenseStreak, 2)
})

Deno.test('positive contribution redeems offense streak', () => {
	const data = ensureReputationShape({ byNodeHash: {}, wantUnknownHits: [], relayBumpSeen: [] })
	adjustNodeReputation(data, PEER, -0.2, 1000, tunables)
	assertEquals(data.byNodeHash[PEER].offenseStreak, 1)
	const bumpsNeeded = Math.ceil(tunables.redemptionCreditPerStreakLevel / tunables.relayRepBump)
	for (let i = 0; i < bumpsNeeded; i++)
		bumpReputationOnRelayPure(data, PEER, `k${i}`, 2000 + i, tunables)
	assertEquals(data.byNodeHash[PEER].offenseStreak ?? 0, 0)
})

Deno.test('pruneReputationFile does not clear offense streak by time', () => {
	const data = ensureReputationShape({
		byNodeHash: {
			[PEER]: { score: -0.5, offenseStreak: 3, lastOffenseAt: 1000 },
		},
		wantUnknownHits: [],
		relayBumpSeen: [],
	})
	pruneReputationFile(data, tunables, 1000 + 86_400_000_000)
	assertEquals(data.byNodeHash[PEER].offenseStreak, 3)
})

Deno.test('badInviteeCount increments and redeems via contribution', () => {
	const data = ensureReputationShape({ byNodeHash: {}, wantUnknownHits: [], relayBumpSeen: [] })
	incrementBadInviteeCount(data, PEER, 2)
	assertEquals(data.byNodeHash[PEER].badInviteeCount, 2)
	const perBad = tunables.inviteRedemptionCreditPerBad
	for (let i = 0; i < Math.ceil(perBad * 2 / tunables.relayRepBump) + 1; i++)
		bumpReputationOnRelayPure(data, PEER, `redeem:${i}`, 5000 + i, tunables)
	assertEquals(data.byNodeHash[PEER].badInviteeCount ?? 0, 0)
})
