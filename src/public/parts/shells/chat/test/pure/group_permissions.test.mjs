/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { checkEventPermission } from '../../src/chat/dag/authorizeEvent.mjs'
import { emptyMaterializedState } from '../../src/chat/dag/groupMaterializedState.mjs'
import { channelReducers } from '../../src/chat/dag/reducers/channels.mjs'
import { canInChannel } from '../../src/group/access.mjs'
import { GROUP_SCOPE_ID, PERMISSIONS } from '../../src/permissions/chat.mjs'

const OWNER = 'a'.repeat(64)
const MODERATOR = 'b'.repeat(64)

/**
 * 构造最小可判权物化状态：默认频道 + 预置 owner/moderator 角色与群权限字段。
 * @returns {object} 最小可判权物化状态（含群权限字段）
 */
function baseState() {
	const state = emptyMaterializedState()
	state.groupSettings.defaultChannelId = 'default'
	state.roles = {
		'@everyone': { permissions: { VIEW_CHANNEL: true, SEND_MESSAGES: true } },
		owner: { permissions: { ADMIN: true } },
		moderator: { permissions: { MANAGE_ROLES: true, KICK_MEMBERS: true } },
	}
	state.members[OWNER] = { status: 'active', roles: ['owner'], memberKind: 'user' }
	state.members[MODERATOR] = { status: 'active', roles: ['moderator'], memberKind: 'user' }
	state.channels.default = { id: 'default', type: 'text', name: 'general', links: [], permissionBlockId: null }
	return state
}

Deno.test('group_permissions_update stores role overrides in groupPermissions', () => {
	let state = baseState()
	state = channelReducers.group_permissions_update(state, {
		content: { roleId: 'moderator', allow: { KICK_MEMBERS: true }, deny: {} },
	})
	assertEquals(state.groupPermissions.moderator, { allow: { KICK_MEMBERS: true }, deny: {} })
	// 群权限用固定 scope 求值：channelPermissions 保持为空。
	assertEquals(state.channelPermissions, {})
})

Deno.test('group permissions evaluate against group scope, independent of channel', () => {
	const state = baseState()
	// moderator 有 MANAGE_ROLES 基权限；在群里 deny 掉 KICK_MEMBERS。
	state.groupPermissions.moderator = { allow: {}, deny: { KICK_MEMBERS: true } }
	assertEquals(canInChannel(state, state.members[MODERATOR], PERMISSIONS.KICK_MEMBERS, 'default'), false)
	// MANAGE_ROLES 未被 deny，仍为 true。
	assertEquals(canInChannel(state, state.members[MODERATOR], PERMISSIONS.MANAGE_ROLES, 'default'), true)
})

Deno.test('group_permissions_update requires MANAGE_ROLES or MANAGE_ADMINS', async () => {
	const state = baseState()
	// 普通成员（无 MANAGE_ROLES / MANAGE_ADMINS）→ 拒。
	const stranger = 'c'.repeat(64)
	state.members[stranger] = { status: 'active', roles: ['@everyone'], memberKind: 'user' }
	assertEquals((await checkEventPermission(state, {
		type: 'group_permissions_update',
		content: { roleId: 'moderator', allow: { KICK_MEMBERS: true }, deny: {} },
	}, stranger)).ok, false)
	// 持有 MANAGE_ROLES 的 moderator → 允许。
	assertEquals((await checkEventPermission(state, {
		type: 'group_permissions_update',
		content: { roleId: 'moderator', allow: { KICK_MEMBERS: true }, deny: {} },
	}, MODERATOR)).ok, true)
	// 仅持有 MANAGE_ADMINS 的成员 → 可通过门控（空覆写内容不触发 grantor 限制）。
	const adminMember = 'd'.repeat(64)
	state.roles.admin = { permissions: { MANAGE_ADMINS: true } }
	state.members[adminMember] = { status: 'active', roles: ['admin'], memberKind: 'user' }
	assertEquals((await checkEventPermission(state, {
		type: 'group_permissions_update',
		content: { roleId: 'moderator', allow: {}, deny: {} },
	}, adminMember)).ok, true)
	// owner（ADMIN 超管）→ 允许。
	assertEquals((await checkEventPermission(state, {
		type: 'group_permissions_update',
		content: { roleId: 'moderator', allow: { KICK_MEMBERS: true }, deny: {} },
	}, OWNER)).ok, true)
})

Deno.test('group permission write cannot include channel-level or superuser bits', async () => {
	const state = baseState()
	assertEquals((await checkEventPermission(state, {
		type: 'group_permissions_update',
		content: { roleId: 'moderator', allow: { SEND_MESSAGES: true }, deny: {} },
	}, OWNER)).ok, false)
	assertEquals((await checkEventPermission(state, {
		type: 'group_permissions_update',
		content: { roleId: 'moderator', allow: { ADMIN: true }, deny: {} },
	}, OWNER)).ok, false)
})

Deno.test('channel permission write cannot include group-level permissions', async () => {
	const state = baseState()
	assertEquals((await checkEventPermission(state, {
		type: 'channel_permissions_update',
		content: { channelId: 'default', roleId: 'moderator', allow: { KICK_MEMBERS: true }, deny: {} },
	}, OWNER)).ok, false)
})

Deno.test('GROUP_SCOPE_ID is a stable reserved id', () => {
	assertEquals(GROUP_SCOPE_ID, '@group')
})
