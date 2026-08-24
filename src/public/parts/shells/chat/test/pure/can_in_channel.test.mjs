/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { emptyMaterializedState } from '../../src/chat/dag/groupMaterializedState.mjs'
import { channelReducers } from '../../src/chat/dag/reducers/channels.mjs'
import { PERMISSIONS } from '../../src/permissions/chat.mjs'
import { canInChannel, governanceChannelId } from '../../src/group/access.mjs'

const MOD = 'b'.repeat(64)

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
	// 根容器（隐藏 category）+ 治理默认频道 + 一个普通频道
	for (const [id, type, name, parent, permBlockId] of [
		['root', 'category', '', null, null],
		['default', 'text', 'general', 'root', 'root'],
		['secret', 'text', 'secret', 'root', 'root'],
	]) {
		state = channelReducers.channel_create(state, {
			timestamp: 1,
			content: { channelId: id, type, name, links: [], parentChannelId: parent, permBlockId },
		})
	}
	return state
}

Deno.test('canInChannel: MANAGE_ROLES evaluates against governance channel overrides, not caller channelId', () => {
	let state = baseState()
	// 在 secret 频道 deny 掉 moderator 的 MANAGE_ROLES；治理频道 default 无 deny。
	state = channelReducers.channel_permissions_update(state, {
		content: {
			channelId: 'secret',
			roleId: 'moderator',
			allow: {},
			deny: { MANAGE_ROLES: true },
		},
	})
	assertEquals(governanceChannelId(state), 'default')
	const member = state.members[MOD]
	// 治理权限：即使调用方传 secret，仍应看治理频道，返回 true。
	assertEquals(canInChannel(state, member, PERMISSIONS.MANAGE_ROLES, 'secret'), true)
	// 频道权限：SEND_MESSAGES 仍按调用方传入频道求值，secret 无 deny，应 true。
	assertEquals(canInChannel(state, member, PERMISSIONS.SEND_MESSAGES, 'secret'), true)
})

Deno.test('canInChannel: channel-level permission honors the passed channelId override', () => {
	let state = baseState()
	state = channelReducers.channel_permissions_update(state, {
		content: {
			channelId: 'secret',
			roleId: 'moderator',
			allow: {},
			deny: { SEND_MESSAGES: true },
		},
	})
	const member = state.members[MOD]
	// 非治理权限仍受传入频道覆写影响。
	assertEquals(canInChannel(state, member, PERMISSIONS.SEND_MESSAGES, 'secret'), false)
})
