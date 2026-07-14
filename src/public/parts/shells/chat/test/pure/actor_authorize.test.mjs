/**
 * actingAgentEntityHash 委托鉴权纯测试。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { encodeEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { agentSubjectHash } from '../../src/chat/lib/entity.mjs'
import { checkEventPermission } from '../../src/chat/dag/authorizeEvent.mjs'
import { emptyMaterializedState } from '../../src/chat/dag/groupMaterializedState.mjs'
import { createDefaultRoles } from 'fount/public/parts/shells/chat/src/permissions/chat.mjs'

/**
 * @returns {object} 带 agent 成员的物化 state
 */
function stateWithAgent() {
	const state = emptyMaterializedState()
	const roles = createDefaultRoles()
	state.roles = roles
	state.channels = { default: { channelId: 'default', name: 'general', type: 'text' } }
	state.groupSettings = { defaultChannelId: 'default' }
	const sender = 'a'.repeat(64)
	const agentHash = encodeEntityHash('c'.repeat(64), agentSubjectHash('chars/agent_char')).toLowerCase()
	state.members[sender] = {
		status: 'active',
		memberKind: 'user',
		pubKeyHash: sender,
		roles: ['founder'],
	}
	state.members[agentHash] = {
		status: 'active',
		memberKind: 'agent',
		agentEntityHash: agentHash,
		charname: 'agent_char',
		ownerPubKeyHash: sender,
		roles: ['admin'],
	}
	return { state, sender, agentHash }
}

Deno.test('actingAgentEntityHash: permissions use agent member row', () => {
	const { state, sender, agentHash } = stateWithAgent()
	const event = {
		type: 'reaction_add',
		channelId: 'default',
		content: {
			actingAgentEntityHash: agentHash,
			targetEventId: 'f'.repeat(64),
			emoji: ':smile:',
		},
	}
	const allowed = checkEventPermission(state, event, sender)
	assertEquals(allowed.ok, true)
})

Deno.test('actingAgentEntityHash: forged sender rejected', () => {
	const { state, agentHash } = stateWithAgent()
	const event = {
		type: 'reaction_add',
		channelId: 'default',
		content: {
			actingAgentEntityHash: agentHash,
			targetEventId: 'f'.repeat(64),
			emoji: ':smile:',
		},
	}
	const denied = checkEventPermission(state, event, 'b'.repeat(64))
	assertEquals(denied.ok, false)
})
