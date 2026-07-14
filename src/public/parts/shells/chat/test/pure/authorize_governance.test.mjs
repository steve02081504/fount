/**
 * 治理类 DAG 事件权限：kick/ban/role 等须持有对应能力；agent 仅 owner 或 ADMIN 可踢。
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
		...overrides,
	}
}

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
	assertEquals(result.reason, 'role_assign ADMIN requires MANAGE_ADMINS')
})
