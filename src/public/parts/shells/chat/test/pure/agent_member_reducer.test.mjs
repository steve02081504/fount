/* global Deno */
import { agentEntityHash } from 'fount/scripts/p2p/entity_id.mjs'
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createEmptySessionState } from '../../src/chat/dag/reducers/helpers.mjs'
import { memberReducers } from '../../src/chat/dag/reducers/members.mjs'
import { roleReducers } from '../../src/chat/dag/reducers/roles.mjs'

Deno.test('agent member_join syncs session.chars; kick removes derived char', () => {
	const node = 'a'.repeat(64)
	const char = 'test_agent_char'
	const agentKey = agentEntityHash(node, `chars/${char}`)
	let state = {
		members: {},
		roles: { '@everyone': {}, admin: { permissions: { ADMIN: true } } },
		bannedMembers: new Set(),
		bannedEntities: new Set(),
		bannedNodes: new Set(),
		inviteEdges: [],
		session: createEmptySessionState(),
	}
	const owner = 'b'.repeat(64)
	state = memberReducers.member_join(state, {
		type: 'member_join', sender: owner, timestamp: 1,
		content: { homeNodeHash: node },
	})
	state = memberReducers.member_join(state, {
		type: 'member_join', sender: owner, timestamp: 2,
		content: {
			memberKind: 'agent',
			charname: char,
			agentEntityHash: agentKey,
			homeNodeHash: node,
			ownerUsername: 'user1',
			roles: ['admin'],
		},
	})
	assertEquals(state.members[agentKey]?.memberKind, 'agent')
	assertEquals(state.session.chars[char]?.ownerUsername, 'user1')
	state = memberReducers.member_kick(state, {
		type: 'member_kick', sender: owner, timestamp: 3,
		content: { targetMemberKey: agentKey },
	})
	assertEquals(state.members[agentKey]?.status, 'kicked')
	assertEquals(Object.keys(state.session.chars), [])
	state = roleReducers.role_assign(state, {
		type: 'role_assign', sender: owner, timestamp: 4,
		content: { targetMemberKey: owner, roleId: 'admin' },
	})
	assertEquals(state.members[owner].roles.includes('admin'), true)
})
