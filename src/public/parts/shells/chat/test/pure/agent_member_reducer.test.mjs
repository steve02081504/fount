/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createEmptySessionState } from '../../src/chat/dag/reducers/state.mjs'
import { memberReducers } from '../../src/chat/dag/reducers/members.mjs'
import { roleReducers } from '../../src/chat/dag/reducers/roles.mjs'

Deno.test('agent member_join syncs session.chars; kick removes derived char', () => {
	const node = 'a'.repeat(64)
	const char = 'test_agent_char'
	const owner = 'b'.repeat(64)
	const agentMemberKey = 'c'.repeat(64)
	const ownerEntity = '1'.repeat(128)
	const agentEntity = '2'.repeat(128)
	let state = {
		members: {},
		roles: { '@everyone': {}, admin: { permissions: { ADMIN: true } } },
		bannedMembers: new Set(),
		bannedEntities: new Set(),
		bannedNodes: new Set(),
		inviteEdges: [],
		session: createEmptySessionState(),
	}
	state = memberReducers.member_join(state, {
		type: 'member_join', sender: owner, timestamp: 1,
		content: { homeNodeHash: node, entityHash: ownerEntity },
	})
	state = memberReducers.member_join(state, {
		type: 'member_join', sender: agentMemberKey, timestamp: 2,
		content: {
			entityHash: agentEntity,
			ownerEntityHash: ownerEntity,
			charname: char,
			homeNodeHash: node,
			ownerUsername: 'user1',
			roles: ['admin'],
		},
	})
	assertEquals(state.members[agentMemberKey]?.memberKind, 'agent')
	assertEquals(state.members[agentMemberKey]?.entityHash, agentEntity)
	assertEquals(state.session.chars[char]?.ownerUsername, 'user1')
	state = memberReducers.member_kick(state, {
		type: 'member_kick', sender: owner, timestamp: 3,
		content: { targetMemberKey: agentMemberKey },
	})
	assertEquals(state.members[agentMemberKey]?.status, 'kicked')
	assertEquals(Object.keys(state.session.chars), [])
	state = roleReducers.role_assign(state, {
		type: 'role_assign', sender: owner, timestamp: 4,
		content: { targetMemberKey: owner, roleId: 'admin' },
	})
	assertEquals(state.members[owner].roles.includes('admin'), true)
})

Deno.test('human member_join keeps ownerEntityHash without becoming agent', () => {
	const node = 'a'.repeat(64)
	const humanKey = 'b'.repeat(64)
	const masterKey = 'c'.repeat(64)
	const humanEntity = '1'.repeat(128)
	const masterEntity = '2'.repeat(128)
	let state = {
		members: {},
		roles: { '@everyone': {} },
		bannedMembers: new Set(),
		bannedEntities: new Set(),
		bannedNodes: new Set(),
		inviteEdges: [],
		session: createEmptySessionState(),
	}
	state = memberReducers.member_join(state, {
		type: 'member_join', sender: humanKey, timestamp: 1,
		content: {
			homeNodeHash: node,
			entityHash: humanEntity,
			ownerEntityHash: masterEntity,
		},
	})
	assertEquals(state.members[humanKey]?.memberKind, 'user')
	assertEquals(state.members[humanKey]?.ownerEntityHash, masterEntity)
	assertEquals(Object.keys(state.session.chars), [])

	state = memberReducers.member_owner_update(state, {
		type: 'member_owner_update', sender: humanKey, timestamp: 2,
		content: { ownerEntityHash: null },
	})
	assertEquals(state.members[humanKey]?.ownerEntityHash, null)

	state = memberReducers.member_owner_update(state, {
		type: 'member_owner_update', sender: humanKey, timestamp: 3,
		content: { ownerEntityHash: masterEntity },
	})
	assertEquals(state.members[humanKey]?.ownerEntityHash, masterEntity)

	state = memberReducers.member_join(state, {
		type: 'member_join', sender: masterKey, timestamp: 4,
		content: { homeNodeHash: node, entityHash: masterEntity },
	})
	assertEquals(state.members[masterKey]?.memberKind, 'user')
})
