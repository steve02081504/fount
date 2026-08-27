/**
 * 联邦治理轮换的重绑语义纯单测。
 * member_ban/member_kick 在 append 路径会立刻失效旧房间，使紧随其后的 group_settings_update.roomSecret
 * 找不到旧槽 live 发布新口令，第三方从此失联；因此治理写入 ban/kick 时显式推迟重绑，
 * 真正的切房由配对写入的 roomSecret 轮换驱动。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { shouldRebindFederationRoomForEvent } from '../../src/chat/federation/rosterChange.mjs'

Deno.test('member_ban rebinds normally outside governance', () => {
	assertEquals(shouldRebindFederationRoomForEvent({ type: 'member_ban', content: { targetMemberKey: 'x' } }), true)
})

Deno.test('governance ban defers rebind to the paired secret rotation', () => {
	assertEquals(shouldRebindFederationRoomForEvent(
		{ type: 'member_ban', content: { targetMemberKey: 'x' } },
		{ skipFederationRebind: true },
	), false)
})

Deno.test('governance kick defers rebind to the paired secret rotation', () => {
	assertEquals(shouldRebindFederationRoomForEvent(
		{ type: 'member_kick', content: { targetMemberKey: 'x' } },
		{ skipFederationRebind: true },
	), false)
})

Deno.test('member_join rebinds to admit the new peer', () => {
	assertEquals(shouldRebindFederationRoomForEvent({ type: 'member_join' }), true)
})

Deno.test('member_leave rebinds to drop the departed peer', () => {
	assertEquals(shouldRebindFederationRoomForEvent({ type: 'member_leave' }), true)
})

Deno.test('group_settings_update with roomSecret rebinds (the real switch)', () => {
	assertEquals(shouldRebindFederationRoomForEvent({ type: 'group_settings_update', content: { roomSecret: 's' } }), true)
})

Deno.test('group_settings_update without roomSecret does not rebind', () => {
	assertEquals(shouldRebindFederationRoomForEvent({ type: 'group_settings_update', content: {} }), false)
})
