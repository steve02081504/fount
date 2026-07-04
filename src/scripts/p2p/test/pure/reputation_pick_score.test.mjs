/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { pickNodeScoreFromReputation } from '../../reputation_pick_score.mjs'

Deno.test('pickNodeScoreFromReputation returns global score only', () => {
	const peer = 'a'.repeat(64)
	const rep = {
		byNodeHash: {
			[peer]: { score: 0.4 },
		},
	}
	assertEquals(pickNodeScoreFromReputation(rep, peer), 0.4)
	assertEquals(pickNodeScoreFromReputation(rep, 'b'.repeat(64)), 0)
})
