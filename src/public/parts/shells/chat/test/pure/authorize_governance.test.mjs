/**
 * 治理类 DAG 事件权限：kick/ban/role 等须持有对应能力；agent 仅 owner 或 ADMIN 可踢；
 * message_edit/delete 允许所属主人管理其发言（人类与 agent 同构）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { checkEventPermission } from '../../src/chat/dag/authorizeEvent.mjs'

const OWNER = 'a'.repeat(64)
const MODERATOR = 'b'.repeat(64)
const STRANGER = 'c'.repeat(64)
const VICTIM = 'd'.repeat(64)
const AGENT_KEY = 'f'.repeat(64)
const OWNER_ENTITY = '1'.repeat(128)
const MOD_ENTITY = '2'.repeat(128)

/**
 * 构造最小可判权物化状态。
 * @param {object} [overrides] state 覆盖项
 * @returns {object} 最小可判权物化状态
 */
function baseState(overrides = {}) {
	return {
		members: {
			[OWNER]: { status: 'active', roles: ['founder'], memberKind: 'user', entityHash: OWNER_ENTITY },
			[MODERATOR]: { status: 'active', roles: ['@everyone', 'moderator'], memberKind: 'user', entityHash: MOD_ENTITY },
			[STRANGER]: { status: 'active', roles: ['@everyone'], memberKind: 'user', entityHash: '3'.repeat(128) },
			[VICTIM]: { status: 'active', roles: ['@everyone'], memberKind: 'user', entityHash: '4'.repeat(128) },
			[AGENT_KEY]: {
				status: 'active',
				memberKind: 'agent',
				ownerEntityHash: OWNER_ENTITY,
				entityHash: '5'.repeat(128),
				charname: 'test_agent',
				roles: ['@everyone'],
			},
		},
		roles: {
			'@everyone': { permissions: { VIEW_CHANNEL: true, SEND_MESSAGES: true } },
			founder: { permissions: { ADMIN: true } },
			moderator: { permissions: { KICK_MEMBERS: true, BAN_MEMBERS: true } },
		},
		channels: { default: { type: 'text' } },
		channelPermissions: {},
		groupSettings: { defaultChannelId: 'default' },
		messageSenderIndex: {},
		messageOverlay: { deletedIds: new Set() },
		...overrides,
	}
}

const AGENT_MSG = 'e'.repeat(64)

Deno.test('message_edit allowed when owner edits own agent message', async () => {
	const state = baseState({
		messageSenderIndex: {
			[AGENT_MSG]: { sender: AGENT_KEY, charId: 'test_agent', channelId: 'default' },
		},
	})
	const event = { type: 'message_edit', channelId: 'default', content: { targetId: AGENT_MSG } }
	assertEquals((await checkEventPermission(state, event, OWNER)).ok, true)
})

Deno.test('message_delete allowed when owner deletes own agent message', async () => {
	const state = baseState({
		messageSenderIndex: {
			[AGENT_MSG]: { sender: AGENT_KEY, charId: 'test_agent', channelId: 'default' },
		},
	})
	const event = { type: 'message_delete', channelId: 'default', content: { targetId: AGENT_MSG } }
	assertEquals((await checkEventPermission(state, event, OWNER)).ok, true)
})

Deno.test('message_edit denied when non-owner edits another agent message', async () => {
	const state = baseState({
		messageSenderIndex: {
			[AGENT_MSG]: { sender: AGENT_KEY, charId: 'test_agent', channelId: 'default' },
		},
	})
	const event = { type: 'message_edit', channelId: 'default', content: { targetId: AGENT_MSG } }
	const result = await checkEventPermission(state, event, MODERATOR)
	assertEquals(result.ok, false)
	assertEquals(result.reason, 'message_edit denied')
})

Deno.test('message_delete allowed with MANAGE_MESSAGES on agent message', async () => {
	const state = baseState({
		roles: {
			...baseState().roles,
			moderator: {
				permissions: {
					KICK_MEMBERS: true,
					BAN_MEMBERS: true,
					MANAGE_MESSAGES: true,
					SEND_MESSAGES: true,
					VIEW_CHANNEL: true,
				},
			},
		},
		messageSenderIndex: {
			[AGENT_MSG]: { sender: AGENT_KEY, charId: 'test_agent', channelId: 'default' },
		},
	})
	const event = { type: 'message_delete', channelId: 'default', content: { targetId: AGENT_MSG } }
	assertEquals((await checkEventPermission(state, event, MODERATOR)).ok, true)
})

Deno.test('member_kick denied without KICK_MEMBERS', async () => {
	const state = baseState()
	const event = { type: 'member_kick', content: { targetMemberKey: VICTIM } }
	const result = await checkEventPermission(state, event, STRANGER)
	assertEquals(result.ok, false)
	assertEquals(result.reason, 'KICK_MEMBERS denied')
})

Deno.test('member_kick allowed with KICK_MEMBERS', async () => {
	const state = baseState()
	const event = { type: 'member_kick', content: { targetMemberKey: VICTIM } }
	assertEquals((await checkEventPermission(state, event, MODERATOR)).ok, true)
})

Deno.test('member_kick allowed when owner kicks own agent', async () => {
	const state = baseState()
	const event = { type: 'member_kick', content: { targetMemberKey: AGENT_KEY } }
	assertEquals((await checkEventPermission(state, event, OWNER)).ok, true)
})

Deno.test('member_kick denied when non-owner with KICK_MEMBERS kicks another member agent', async () => {
	const state = baseState()
	const event = { type: 'member_kick', content: { targetMemberKey: AGENT_KEY } }
	const result = await checkEventPermission(state, event, MODERATOR)
	assertEquals(result.ok, false)
	assertEquals(result.reason, 'agent kick denied')
})

Deno.test('member_kick allowed when ADMIN kicks another owner agent', async () => {
	const state = baseState({
		members: {
			...baseState().members,
			[AGENT_KEY]: {
				...baseState().members[AGENT_KEY],
				ownerEntityHash: MOD_ENTITY,
			},
		},
	})
	const event = { type: 'member_kick', content: { targetMemberKey: AGENT_KEY } }
	assertEquals((await checkEventPermission(state, event, OWNER)).ok, true)
})

Deno.test('member_kick denied when non-owner without KICK_MEMBERS kicks agent', async () => {
	const state = baseState({
		members: {
			...baseState().members,
			[AGENT_KEY]: {
				...baseState().members[AGENT_KEY],
				ownerEntityHash: MOD_ENTITY,
			},
		},
	})
	const event = { type: 'member_kick', content: { targetMemberKey: AGENT_KEY } }
	const result = await checkEventPermission(state, event, STRANGER)
	assertEquals(result.ok, false)
	assertEquals(result.reason, 'agent kick denied')
})

Deno.test('member_ban denied without BAN_MEMBERS', async () => {
	const state = baseState()
	const event = { type: 'member_ban', content: { targetMemberKey: VICTIM, banScope: 'entity' } }
	const result = await checkEventPermission(state, event, STRANGER)
	assertEquals(result.ok, false)
	assertEquals(result.reason, 'BAN_MEMBERS denied')
})

Deno.test('member_ban allowed with BAN_MEMBERS', async () => {
	const state = baseState()
	const event = { type: 'member_ban', content: { targetMemberKey: VICTIM, banScope: 'entity' } }
	assertEquals((await checkEventPermission(state, event, MODERATOR)).ok, true)
})

Deno.test('role_assign ADMIN requires MANAGE_ADMINS', async () => {
	const state = baseState({
		roles: {
			...baseState().roles,
			moderator: { permissions: { KICK_MEMBERS: true, BAN_MEMBERS: true, MANAGE_ROLES: true } },
			'new-admin': { permissions: { ADMIN: true } },
		},
	})
	const event = { type: 'role_assign', content: { targetMemberKey: VICTIM, roleId: 'new-admin' } }
	const result = await checkEventPermission(state, event, MODERATOR)
	assertEquals(result.ok, false)
	assertEquals(result.reason, 'role_assign ADMIN/MANAGE_ADMINS requires MANAGE_ADMINS')
})

Deno.test('role_update cannot grant ADMIN without MANAGE_ADMINS', async () => {
	const state = baseState({
		roles: {
			...baseState().roles,
			moderator: { permissions: { KICK_MEMBERS: true, MANAGE_ROLES: true, VIEW_CHANNEL: true, SEND_MESSAGES: true } },
		},
	})
	const event = {
		type: 'role_update',
		content: {
			roleId: 'moderator',
			updates: { permissions: { KICK_MEMBERS: true, MANAGE_ROLES: true, ADMIN: true } },
		},
	}
	const result = await checkEventPermission(state, event, MODERATOR)
	assertEquals(result.ok, false)
	assertEquals(result.reason, 'ADMIN/MANAGE_ADMINS role mutation requires MANAGE_ADMINS')
})

Deno.test('role_create cannot grant ADMIN without MANAGE_ADMINS', async () => {
	const state = baseState({
		roles: {
			...baseState().roles,
			moderator: { permissions: { MANAGE_ROLES: true, VIEW_CHANNEL: true, SEND_MESSAGES: true } },
		},
	})
	const event = {
		type: 'role_create',
		content: {
			roleId: 'evil',
			name: 'Evil',
			permissions: { ADMIN: true },
		},
	}
	const result = await checkEventPermission(state, event, MODERATOR)
	assertEquals(result.ok, false)
	assertEquals(result.reason, 'ADMIN/MANAGE_ADMINS role mutation requires MANAGE_ADMINS')
})

Deno.test('role_update cannot grant permissions grantor lacks', async () => {
	const state = baseState({
		roles: {
			...baseState().roles,
			moderator: { permissions: { MANAGE_ROLES: true, VIEW_CHANNEL: true, SEND_MESSAGES: true } },
		},
	})
	const event = {
		type: 'role_update',
		content: {
			roleId: '@everyone',
			updates: { permissions: { VIEW_CHANNEL: true, SEND_MESSAGES: true, BAN_MEMBERS: true } },
		},
	}
	const result = await checkEventPermission(state, event, MODERATOR)
	assertEquals(result.ok, false)
	assertEquals(result.reason, 'role permissions exceed grantor')
})

Deno.test('role_update name-only on non-admin role allowed with MANAGE_ROLES', async () => {
	const state = baseState({
		roles: {
			...baseState().roles,
			moderator: { permissions: { MANAGE_ROLES: true, VIEW_CHANNEL: true, SEND_MESSAGES: true } },
		},
	})
	const event = {
		type: 'role_update',
		content: { roleId: 'moderator', updates: { name: 'Staff' } },
	}
	assertEquals((await checkEventPermission(state, event, MODERATOR)).ok, true)
})

Deno.test('channel_permissions_update cannot allow ADMIN', async () => {
	const state = baseState({
		roles: {
			...baseState().roles,
			moderator: {
				permissions: {
					MANAGE_ROLES: true,
					MANAGE_CHANNELS: true,
					VIEW_CHANNEL: true,
					SEND_MESSAGES: true,
				},
			},
		},
	})
	const event = {
		type: 'channel_permissions_update',
		content: {
			channelId: 'default',
			roleId: '@everyone',
			allow: { ADMIN: true },
			deny: {},
		},
	}
	const result = await checkEventPermission(state, event, MODERATOR)
	assertEquals(result.ok, false)
	assertEquals(result.reason, 'channel allow cannot include ADMIN or MANAGE_ADMINS')
})

Deno.test('cabinet_bind requires ADMIN or MANAGE_ADMINS', async () => {
	const state = baseState({
		roles: {
			...baseState().roles,
			moderator: { permissions: { MANAGE_ROLES: true, VIEW_CHANNEL: true } },
		},
	})
	const event = {
		type: 'cabinet_bind',
		content: { cabinet_id: 'a'.repeat(64), role_access: { moderator: 'rw' } },
	}
	const denied = await checkEventPermission(state, event, MODERATOR)
	assertEquals(denied.ok, false)
	assertEquals(denied.reason, 'ADMIN or MANAGE_ADMINS required')
	assertEquals((await checkEventPermission(state, event, OWNER)).ok, true)
})

Deno.test('cabinet_key_update role_access requires ADMIN; keyWraps alone needs MANAGE_ROLES', async () => {
	const state = baseState({
		roles: {
			...baseState().roles,
			moderator: { permissions: { MANAGE_ROLES: true, VIEW_CHANNEL: true } },
		},
	})
	const steal = {
		type: 'cabinet_key_update',
		content: { cabinet_id: 'a'.repeat(64), role_access: { moderator: 'rw' } },
	}
	const stealDenied = await checkEventPermission(state, steal, MODERATOR)
	assertEquals(stealDenied.ok, false)
	assertEquals(stealDenied.reason, 'cabinet role_access change requires ADMIN or MANAGE_ADMINS')
	assertEquals((await checkEventPermission(state, steal, OWNER)).ok, true)

	const rotate = {
		type: 'cabinet_key_update',
		content: { cabinet_id: 'a'.repeat(64), keyWraps: {}, read_generation: 2 },
	}
	assertEquals((await checkEventPermission(state, rotate, MODERATOR)).ok, true)
	const strangerRotate = await checkEventPermission(state, rotate, STRANGER)
	assertEquals(strangerRotate.ok, false)
	assertEquals(strangerRotate.reason, 'MANAGE_ROLES required')
})

const HUMAN_MSG = '9'.repeat(64)

Deno.test('message_edit allowed when owner edits owned human message', async () => {
	const state = baseState({
		members: {
			...baseState().members,
			[VICTIM]: {
				status: 'active',
				roles: ['@everyone'],
				memberKind: 'user',
				entityHash: '4'.repeat(128),
				ownerEntityHash: OWNER_ENTITY,
			},
		},
		messageSenderIndex: { [HUMAN_MSG]: { sender: VICTIM, channelId: 'default' } },
	})
	const event = { type: 'message_edit', channelId: 'default', content: { targetId: HUMAN_MSG } }
	assertEquals((await checkEventPermission(state, event, OWNER)).ok, true)
})

Deno.test('message_delete allowed when owner deletes owned human message', async () => {
	const state = baseState({
		members: {
			...baseState().members,
			[VICTIM]: {
				status: 'active',
				roles: ['@everyone'],
				memberKind: 'user',
				entityHash: '4'.repeat(128),
				ownerEntityHash: OWNER_ENTITY,
			},
		},
		messageSenderIndex: { [HUMAN_MSG]: { sender: VICTIM, channelId: 'default' } },
	})
	const event = { type: 'message_delete', channelId: 'default', content: { targetId: HUMAN_MSG } }
	assertEquals((await checkEventPermission(state, event, OWNER)).ok, true)
})

Deno.test('member_owner_update allowed for active member self', async () => {
	const state = baseState()
	const event = { type: 'member_owner_update', content: { ownerEntityHash: MOD_ENTITY } }
	assertEquals((await checkEventPermission(state, event, VICTIM)).ok, true)
})
