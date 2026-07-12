/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { checkEventPermission } from '../../src/chat/dag/authorizeEvent.mjs'
import { emptyMaterializedState } from '../../src/chat/dag/groupMaterializedState.mjs'
import { isVoteBallotClosed } from '../../src/chat/lib/voteBallots.mjs'
import { createDefaultRoles } from '../../src/permissions/chat.mjs'

const SENDER = '11'.repeat(32)

Deno.test('isVoteBallotClosed after deadline', () => {
	const ballot = { deadline: new Date(Date.now() - 1000).toISOString() }
	assertEquals(isVoteBallotClosed(ballot), true)
	assertEquals(isVoteBallotClosed({ deadline: new Date(Date.now() + 60_000).toISOString() }), false)
})

Deno.test('authorizeEvent rejects vote_cast after deadline', () => {
	const state = emptyMaterializedState()
	state.roles = createDefaultRoles()
	state.members = {
		[SENDER]: {
			status: 'active',
			roles: ['@everyone', 'admin'],
		},
	}
	state.voteBallots = {
		ballot1: {
			channelId: 'default',
			deadline: new Date(Date.now() - 1000).toISOString(),
			question: 'q',
			sender: SENDER,
		},
	}
	const event = {
		type: 'vote_cast',
		channelId: 'default',
		sender: SENDER,
		hlc: { wall: Date.now() },
		content: { ballotId: 'ballot1', choice: 'yes' },
	}
	const verdict = checkEventPermission(state, event, SENDER)
	assertEquals(verdict.ok, false)
})
