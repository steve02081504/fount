/**
 * 联邦乱序入站：message_edit / message_delete 在目标消息尚未到达时应标记为 deferrable，
 * 供 remoteIngest 走 quarantine/defer 重试而非永久 drop；真正的权限拒绝则不可 defer。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { assertEventPermission, checkEventPermission } from '../src/chat/dag/authorizeEvent.mjs'

const SENDER = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const TARGET = 'd'.repeat(64)

/**
 * @param {object} [overrides] state 覆盖项
 * @returns {object} 最小可判权的物化状态桩
 */
function baseState(overrides = {}) {
	return {
		members: {
			[SENDER]: { status: 'active', roles: ['@everyone'] },
			[OTHER]: { status: 'active', roles: ['@everyone'] },
		},
		roles: { '@everyone': { permissions: { SEND_MESSAGES: true, MANAGE_MESSAGES: false } } },
		channels: {},
		channelPermissions: {},
		groupSettings: {},
		messageSenderIndex: {},
		messageOverlay: { deletedIds: new Set() },
		...overrides,
	}
}

Deno.test('message_edit with absent target is deferrable (not a hard denial)', () => {
	const state = baseState()
	const event = { type: 'message_edit', channelId: 'default', content: { targetId: TARGET } }
	const result = checkEventPermission(state, event, SENDER)
	assertEquals(result.ok, false)
	assertEquals(result.reason, 'message not found')
	assertEquals(result.deferrable, true)

	let thrown
	try { assertEventPermission(state, event, SENDER) }
	catch (error) { thrown = error }
	assertEquals(thrown?.deferrable, true)
})

Deno.test('message_delete with absent target is deferrable', () => {
	const state = baseState()
	const event = { type: 'message_delete', channelId: 'default', content: { targetId: TARGET } }
	const result = checkEventPermission(state, event, SENDER)
	assertEquals(result.ok, false)
	assertEquals(result.deferrable, true)
})

Deno.test('message_edit denial for non-owner present target is NOT deferrable', () => {
	const state = baseState({
		messageSenderIndex: { [TARGET]: { sender: OTHER, charOwner: null, charId: null, channelId: 'default' } },
	})
	const event = { type: 'message_edit', channelId: 'default', content: { targetId: TARGET } }
	const result = checkEventPermission(state, event, SENDER)
	assertEquals(result.ok, false)
	assertEquals(result.reason, 'message_edit denied')
	assertEquals(result.deferrable, undefined)

	let thrown
	try { assertEventPermission(state, event, SENDER) }
	catch (error) { thrown = error }
	assertEquals(thrown?.deferrable, undefined)
})

Deno.test('message_edit by author with present target is allowed', () => {
	const state = baseState({
		messageSenderIndex: { [TARGET]: { sender: SENDER, charOwner: null, charId: null, channelId: 'default' } },
	})
	const event = { type: 'message_edit', channelId: 'default', content: { targetId: TARGET } }
	assertEquals(checkEventPermission(state, event, SENDER).ok, true)
})

Deno.test('message_edit referencing an already-deleted target is NOT deferrable', () => {
	const state = baseState({ messageOverlay: { deletedIds: new Set([TARGET]) } })
	const event = { type: 'message_edit', channelId: 'default', content: { targetId: TARGET } }
	const result = checkEventPermission(state, event, SENDER)
	assertEquals(result.ok, false)
	assertEquals(result.reason, 'message not found')
	assertEquals(result.deferrable, false)
})
