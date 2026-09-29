/**
 * 回归：频道类事件的权限必须按事件真实目标频道求值（`content.channelId`），
 * 而不是伪造的 `'default'`。否则仅在默认频道有 MANAGE_CHANNELS 的成员可越权删除/改名其它频道。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { assertEventPermission, checkEventPermission, eventChannelId } from '../../src/chat/dag/authorizeEvent.mjs'

const OWNER = 'a'.repeat(64)
const MODERATOR = 'b'.repeat(64)
const OWNER_ENTITY = '1'.repeat(128)
const MOD_ENTITY = '2'.repeat(128)

/**
 * 构造最小可判权物化状态：MODERATOR 仅在 default 频道拥有 MANAGE_CHANNELS 覆写。
 * @param {object} [overrides] state 覆盖项
 * @returns {object} 最小可判权物化状态
 */
function baseState(overrides = {}) {
	return {
		members: {
			[OWNER]: { status: 'active', roles: ['founder'], memberKind: 'user', entityHash: OWNER_ENTITY },
			[MODERATOR]: { status: 'active', roles: ['@everyone', 'moderator'], memberKind: 'user', entityHash: MOD_ENTITY },
		},
		roles: {
			'@everyone': { permissions: { VIEW_CHANNEL: true, SEND_MESSAGES: true } },
			founder: { permissions: { ADMIN: true } },
			moderator: { permissions: { VIEW_CHANNEL: true, SEND_MESSAGES: true } },
		},
		channels: { default: { type: 'text' }, general: { type: 'text' } },
		channelPermissions: {
			default: { moderator: { allow: { MANAGE_CHANNELS: true, VIEW_CHANNEL: true }, deny: {} } },
		},
		groupSettings: { defaultChannelId: 'default', rootChannelId: 'default' },
		messageSenderIndex: {},
		messageOverlay: { deletedIds: new Set() },
		...overrides,
	}
}

Deno.test('eventChannelId prefers explicit target and never fabricates default', () => {
	assertEquals(eventChannelId({ type: 'channel_delete', content: { channelId: 'general' } }), 'general')
	assertEquals(eventChannelId({ type: 'message', channelId: 'general' }), 'general')
	assertEquals(eventChannelId({ type: 'channel_key_rotate_batch' }), '')
})

Deno.test('channel_delete checks the target channel, not the default channel', async () => {
	const state = baseState()
	// 目标 general 无 MANAGE_CHANNELS 覆写 → 拒绝（旧实现会错误地在 'default' 上放行）
	const denied = await checkEventPermission(state, {
		type: 'channel_delete',
		content: { channelId: 'general' },
	}, MODERATOR)
	assertEquals(denied.ok, false)
	assertEquals(denied.reason, 'MANAGE_CHANNELS denied')
	// 目标 default 本身有覆写 → 放行
	assertEquals((await checkEventPermission(state, {
		type: 'channel_delete',
		content: { channelId: 'default' },
	}, MODERATOR)).ok, true)
	// ADMIN 不受频道覆写限制
	assertEquals((await checkEventPermission(state, {
		type: 'channel_delete',
		content: { channelId: 'general' },
	}, OWNER)).ok, true)
})

Deno.test('channel_update metadata checks the target channel, not the default channel', async () => {
	const state = baseState()
	const denied = await checkEventPermission(state, {
		type: 'channel_update',
		content: { channelId: 'general', updates: { name: 'renamed' } },
	}, MODERATOR)
	assertEquals(denied.ok, false)
	assertEquals(denied.reason, 'MANAGE_CHANNELS required for channel metadata updates')
	assertEquals((await checkEventPermission(state, {
		type: 'channel_update',
		content: { channelId: 'default', updates: { name: 'renamed' } },
	}, MODERATOR)).ok, true)
})

Deno.test('channel_delete without MANAGE_CHANNELS on the target throws 403', async () => {
	const state = baseState()
	try {
		await assertEventPermission(state, {
			type: 'channel_delete',
			content: { channelId: 'general' },
		}, MODERATOR)
		throw new Error('expected assertEventPermission to throw')
	}
	catch (error) {
		assertEquals(error.http_code, 403)
		assertEquals(error.message, 'MANAGE_CHANNELS denied')
	}
})
