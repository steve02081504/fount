/**
 * 权限主体恒为 sender（无 acting overlay）纯测试。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { checkEventPermission } from '../../src/chat/dag/authorizeEvent.mjs'
import { emptyMaterializedState } from '../../src/chat/dag/groupMaterializedState.mjs'
import { createDefaultRoles } from 'fount/public/parts/shells/chat/src/permissions/chat.mjs'

/**
 * @returns {{ state: object, sender: string, peer: string }} 双成员物化 state
 */
function stateWithTwoMembers() {
	const state = emptyMaterializedState()
	const roles = createDefaultRoles()
	state.roles = roles
	state.channels = { default: { channelId: 'default', name: 'general', type: 'text' } }
	state.groupSettings = { defaultChannelId: 'default' }
	const sender = 'a'.repeat(64)
	const peer = 'b'.repeat(64)
	state.members[sender] = {
		status: 'active',
		memberKind: 'user',
		pubKeyHash: sender,
		roles: ['@everyone'],
	}
	state.members[peer] = {
		status: 'active',
		memberKind: 'user',
		pubKeyHash: peer,
		roles: ['@everyone'],
	}
	return { state, sender, peer }
}

Deno.test('permissions use sender member row', async () => {
	const { state, sender } = stateWithTwoMembers()
	const event = {
		type: 'reaction_add',
		channelId: 'default',
		content: {
			targetEventId: 'f'.repeat(64),
			emoji: ':smile:',
		},
	}
	const allowed = await checkEventPermission(state, event, sender)
	assertEquals(allowed.ok, true)
})

Deno.test('non-member sender rejected', async () => {
	const { state } = stateWithTwoMembers()
	const event = {
		type: 'reaction_add',
		channelId: 'default',
		content: {
			targetEventId: 'f'.repeat(64),
			emoji: ':smile:',
		},
	}
	const denied = await checkEventPermission(state, event, 'c'.repeat(64))
	assertEquals(denied.ok, false)
	assertEquals(denied.reason, 'requires active member sender')
})

Deno.test('stale actingAgentEntityHash field is ignored', async () => {
	const { state, sender, peer } = stateWithTwoMembers()
	state.members[peer].roles = ['admin']
	const event = {
		type: 'channel_create',
		content: {
			actingAgentEntityHash: peer,
			channelId: 'x',
			name: 'x',
			type: 'text',
		},
	}
	// sender 无 MANAGE_CHANNELS；旧 acting overlay 不得借 peer 权限放行
	const denied = await checkEventPermission(state, event, sender)
	assertEquals(denied.ok, false)
})
