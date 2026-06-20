/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	computeJoinPowHash,
	joinPowHashMeetsDifficulty,
	JOIN_POW_DEFAULT_EPOCH_MS,
	solveJoinPow,
	verifyJoinPow,
} from '../join_pow.mjs'

const GROUP = 'g-test'
const ANCHOR = 'a'.repeat(64)
const JOINER = 'b'.repeat(64)

Deno.test('joinPowHashMeetsDifficulty checks leading zero bits', () => {
	assertEquals(joinPowHashMeetsDifficulty('0000ffff', 16), true)
	assertEquals(joinPowHashMeetsDifficulty('0001ffff', 16), false)
	assertEquals(joinPowHashMeetsDifficulty('0000000f', 28), true)
})

Deno.test('verifyJoinPow accepts valid solution', () => {
	const epochMs = JOIN_POW_DEFAULT_EPOCH_MS
	const epoch = Math.floor(Date.now() / epochMs)
	const solution = solveJoinPow({
		groupId: GROUP,
		anchorRef: ANCHOR,
		joinerNodeHash: JOINER,
		epoch,
	}, 8)
	if (!solution) throw new Error('solveJoinPow failed')
	const ok = verifyJoinPow(solution, {
		groupId: GROUP,
		senderNodeHash: JOINER,
		knownAnchors: [ANCHOR],
		now: epoch * epochMs,
		difficultyBits: 8,
		epochMs,
	})
	assertEquals(ok, true)
})

Deno.test('verifyJoinPow rejects wrong anchor and sender binding', () => {
	const epochMs = JOIN_POW_DEFAULT_EPOCH_MS
	const epoch = Math.floor(Date.now() / epochMs)
	const solution = solveJoinPow({
		groupId: GROUP,
		anchorRef: ANCHOR,
		joinerNodeHash: JOINER,
		epoch,
	}, 6)
	if (!solution) throw new Error('solveJoinPow failed')
	assertEquals(verifyJoinPow(solution, {
		groupId: GROUP,
		senderNodeHash: JOINER,
		knownAnchors: ['c'.repeat(64)],
		difficultyBits: 6,
		epochMs,
		now: epoch * epochMs,
	}), false)
	assertEquals(verifyJoinPow(solution, {
		groupId: GROUP,
		senderNodeHash: 'd'.repeat(64),
		knownAnchors: [ANCHOR],
		difficultyBits: 6,
		epochMs,
		now: epoch * epochMs,
	}), false)
})

Deno.test('computeJoinPowHash is deterministic', () => {
	const a = computeJoinPowHash({ groupId: GROUP, anchorRef: ANCHOR, joinerNodeHash: JOINER, epoch: 1, nonce: '7' })
	const b = computeJoinPowHash({ groupId: GROUP, anchorRef: ANCHOR, joinerNodeHash: JOINER, epoch: 1, nonce: '7' })
	assertEquals(a, b)
	assertEquals(a.length, 64)
})
