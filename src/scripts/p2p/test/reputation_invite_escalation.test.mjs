/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	applyDecayCollusionAfterSlashPure,
	computeInviteEscalation,
	defaultReputationTunables,
	ensureReputationShape,
	incrementBadInviteeCount,
} from '../reputation_engine.mjs'

const tunables = defaultReputationTunables()
const BAD = 'b'.repeat(64)
const INTRO = 'c'.repeat(64)
const ROOT = 'd'.repeat(64)

Deno.test('computeInviteEscalation scales with badInviteeCount', () => {
	assertEquals(computeInviteEscalation(0, tunables), 1)
	assertEquals(computeInviteEscalation(1, tunables), 1.5)
	assertEquals(computeInviteEscalation(3, tunables), 2.5)
	assertEquals(computeInviteEscalation(100, tunables), tunables.inviteBadEscalationMax)
})

Deno.test('repeat bad invites increase slash penalty on same introducer', () => {
	const data = ensureReputationShape({ byNodeHash: {}, wantUnknownHits: [], relayBumpSeen: [] })
	data.byNodeHash[INTRO] = { score: 1 }
	const edges = [{ from: INTRO, to: BAD }]
	applyDecayCollusionAfterSlashPure(data, BAD, edges, tunables)
	const first = data.byNodeHash[INTRO].score
	incrementBadInviteeCount(data, INTRO, 2)
	applyDecayCollusionAfterSlashPure(data, BAD, edges, tunables)
	const second = data.byNodeHash[INTRO].score
	assertEquals(first > 0.9, true)
	assertEquals(second < first - 0.05, true)
	assertEquals(data.byNodeHash[INTRO].badInviteeCount >= 3, true)
})

Deno.test('deep chain gets extended hop when introducer has many bad invites', () => {
	const data = ensureReputationShape({
		byNodeHash: {
			[ROOT]: { score: 1 },
			[INTRO]: { score: 1, badInviteeCount: 4 },
		},
		wantUnknownHits: [],
		relayBumpSeen: [],
	})
	const edges = [
		{ from: INTRO, to: BAD },
		{ from: ROOT, to: INTRO },
	]
	const applied = applyDecayCollusionAfterSlashPure(data, BAD, edges, tunables)
	const rootHit = applied.find(row => row.node === ROOT)
	assertEquals(typeof rootHit?.dRep, 'number')
	assertEquals(rootHit.dRep > 0, true)
})
