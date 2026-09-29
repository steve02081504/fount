/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { groupIdFromRoomKey } from '../../src/chat/ws/groupWsBroadcast.mjs'
import { groupWsRoomKey, resolveGroupWsRoomKey } from '../../src/chat/ws/groupWsRooms.mjs'

Deno.test('groupIdFromRoomKey strips the owner node hash from a room key', () => {
	assertEquals(groupIdFromRoomKey(groupWsRoomKey('a'.repeat(64), 'g1')), 'g1')
})

Deno.test('groupIdFromRoomKey returns a bare group id unchanged', () => {
	assertEquals(groupIdFromRoomKey('g1'), 'g1')
})

Deno.test('groupIdFromRoomKey recovers the group id resolveGroupWsRoomKey built', () => {
	assertEquals(groupIdFromRoomKey(resolveGroupWsRoomKey('g2', 'nodehash')), 'g2')
})
