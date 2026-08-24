/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { emptyMaterializedState } from '../../src/chat/dag/groupMaterializedState.mjs'
import { channelReducers } from '../../src/chat/dag/reducers/channels.mjs'
import { canInChannel, governanceChannelId } from '../../src/group/access.mjs'
import { PERMISSIONS } from '../../src/permissions/chat.mjs'

const MOD = 'b'.repeat(64)

/**
 * @returns {object} 最小可判权物化状态（default + secret 两个脱钩频道）
 */
function baseState() {
	let state = emptyMaterializedState()
	state.groupSettings.defaultChannelId = 'default'
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
	// 全部脱钩（permBlockId null）→ 各频道自持权限块，覆写落在自身。
	for (const [id, type, name] of [
		['default', 'text', 'general'],
		['secret', 'text', 'secret'],
	]) 
		state = channelReducers.channel_create(state, {
			timestamp: 1,
			content: { channelId: id, type, name, links: [], permBlockId: null },
		})
	
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
	// 治理权限：即使调用方传 secret（其上已 deny MANAGE_ROLES），仍应看治理频道 default，返回 true。
	assertEquals(canInChannel(state, member, PERMISSIONS.MANAGE_ROLES, 'secret'), true)
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
	// 非治理权限仍受传入频道自身覆写影响。
	assertEquals(canInChannel(state, member, PERMISSIONS.SEND_MESSAGES, 'secret'), false)
	// 治理频道 default 上的 SEND_MESSAGES 未被 deny。
	assertEquals(canInChannel(state, member, PERMISSIONS.SEND_MESSAGES, 'default'), true)
})
