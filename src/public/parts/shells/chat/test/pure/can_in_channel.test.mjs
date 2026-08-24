/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { emptyMaterializedState } from '../../src/chat/dag/groupMaterializedState.mjs'
import { channelReducers } from '../../src/chat/dag/reducers/channels.mjs'
import { canInChannel, governanceChannelId } from '../../src/group/access.mjs'
import { PERMISSIONS } from '../../src/permissions/chat.mjs'

const MOD = 'b'.repeat(64)

/**
 * @returns {object} 最小可判权物化状态（根容器 + 默认频道 + 普通频道，默认继承根块）
 */
function baseState() {
	const state = emptyMaterializedState()
	state.groupSettings.defaultChannelId = 'default'
	state.groupSettings.rootChannelId = 'root'
	state.roles = {
		'@everyone': { permissions: { VIEW_CHANNEL: true, SEND_MESSAGES: true } },
		moderator: { permissions: { MANAGE_ROLES: true, SEND_MESSAGES: true, VIEW_CHANNEL: true } },
	}
	state.members[MOD] = {
		status: 'active',
		pubKeyHex: MOD,
		roles: ['@everyone', 'moderator'],
		memberKind: 'human',
	}
	// 根容器（隐藏 category）+ 治理默认频道 + 一个普通频道；子频道默认同步根权限块。
	for (const [id, type, name, parent, permissionBlockId] of [
		['root', 'category', '', null, null],
		['default', 'text', 'general', 'root', 'root'],
		['secret', 'text', 'secret', 'root', 'root'],
	]) {
		channelReducers.channel_create(state, {
			timestamp: 1,
			content: { channelId: id, type, name, links: [], parentChannelId: parent, permissionBlockId },
		})
	}
	return state
}

Deno.test('canInChannel: group permission evaluates against group scope, not caller channelId', () => {
	const state = baseState()
	// 在群权限 deny 掉 moderator 的 MANAGE_ROLES；频道层面无 deny。
	state.channelPermissions.secret = {
		moderator: { allow: {}, deny: { MANAGE_ROLES: true } },
	}
	assertEquals(governanceChannelId(state), 'default')
	const member = state.members[MOD]
	// 治理权限按群 scope 求值：即使频道 secret 覆写 deny MANAGE_ROLES，仍返回 true。
	assertEquals(canInChannel(state, member, PERMISSIONS.MANAGE_ROLES, 'secret'), true)
})

Deno.test('canInChannel: channel-level permission honors the passed channelId override', () => {
	const state = baseState()
	// secret 跟随根块：在根块上 deny 掉 SEND_MESSAGES（secret 与 default 均受影响）。
	state.channelPermissions.root = {
		moderator: { allow: {}, deny: { SEND_MESSAGES: true } },
	}
	const member = state.members[MOD]
	// 频道权限按调用方传入频道求值；secret 同步根块，故被 deny。
	assertEquals(canInChannel(state, member, PERMISSIONS.SEND_MESSAGES, 'secret'), false)
})

Deno.test('canInChannel: array of permissions is satisfied when any granted (mixed scope)', () => {
	const state = baseState()
	const member = state.members[MOD]
	// moderator 有 MANAGE_ROLES（群权限）与 SEND_MESSAGES（频道权限）。
	// 数组中仅一个满足即 true。
	assertEquals(canInChannel(state, member, [PERMISSIONS.MANAGE_ROLES, PERMISSIONS.KICK_MEMBERS], 'secret'), true)
	// 全部不满足 → false。
	assertEquals(canInChannel(state, member, [PERMISSIONS.KICK_MEMBERS, PERMISSIONS.BAN_MEMBERS], 'secret'), false)
})
