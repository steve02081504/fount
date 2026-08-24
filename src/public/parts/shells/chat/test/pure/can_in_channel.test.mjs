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
	let state = baseState()
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
	let state = baseState()
	state.channelPermissions.secret = {
		moderator: { allow: {}, deny: { SEND_MESSAGES: true } },
	}
	const member = state.members[MOD]
	// 非治理权限仍受传入频道自身覆写影响。
	assertEquals(canInChannel(state, member, PERMISSIONS.SEND_MESSAGES, 'secret'), false)
	// 治理频道 default 上的 SEND_MESSAGES 未被 deny。
	assertEquals(canInChannel(state, member, PERMISSIONS.SEND_MESSAGES, 'default'), true)
})
