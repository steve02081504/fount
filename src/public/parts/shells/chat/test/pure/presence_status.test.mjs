/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import {
	computeEffectiveStatus,
	HEARTBEAT_STALE_MS,
} from 'fount/public/parts/shells/chat/src/entity/presenceStatus.mjs'

const SELF = 'a'.repeat(128)

Deno.test('computeEffectiveStatus: 默认 offline + 近期心跳 → online', () => {
	assertEquals(computeEffectiveStatus({
		entityHash: SELF,
		status: 'offline',
		lastSeenAt: Date.now(),
	}, SELF, { isSelf: true }), 'online')
})

Deno.test('computeEffectiveStatus: 无心跳 → offline', () => {
	assertEquals(computeEffectiveStatus({
		entityHash: SELF,
		status: 'online',
		lastSeenAt: 0,
	}, SELF), 'offline')
	assertEquals(computeEffectiveStatus({
		entityHash: SELF,
		status: 'online',
		lastSeenAt: Date.now() - HEARTBEAT_STALE_MS - 1,
	}, SELF), 'offline')
})

Deno.test('computeEffectiveStatus: dnd + 近期心跳保持 dnd', () => {
	assertEquals(computeEffectiveStatus({
		entityHash: SELF,
		status: 'dnd',
		lastSeenAt: Date.now(),
	}, SELF, { isSelf: true }), 'dnd')
})

Deno.test('computeEffectiveStatus: invisible 仅本人可见', () => {
	const profile = {
		entityHash: SELF,
		status: 'invisible',
		lastSeenAt: Date.now(),
	}
	assertEquals(computeEffectiveStatus(profile, SELF, { isSelf: true }), 'invisible')
	assertEquals(computeEffectiveStatus(profile, 'b'.repeat(128), { isSelf: false }), 'offline')
})
