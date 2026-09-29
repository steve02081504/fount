/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import {
	groupWsRoomKey,
	registerGroupReplicaNode,
	replicaNodeByGroupId,
	resolveGroupWsRoomKey,
} from '../../src/chat/ws/groupWsRooms.mjs'

Deno.test('groupWsRoomKey joins owner node hash and group id', () => {
	assertEquals(groupWsRoomKey('abc', 'g1'), 'abc:g1')
})

Deno.test('resolveGroupWsRoomKey prefers registered replica node hash over fallback', () => {
	const groupId = 'group-registry-test'
	const node = 'a'.repeat(64)
	try {
		registerGroupReplicaNode(node, groupId)
		assertEquals(resolveGroupWsRoomKey(groupId), groupWsRoomKey(node, groupId))
		assertEquals(resolveGroupWsRoomKey(groupId, 'username-as-node'), groupWsRoomKey(node, groupId))
	}
	finally {
		replicaNodeByGroupId.delete(groupId)
	}
})

Deno.test('resolveGroupWsRoomKey falls back to bare group id only without any node hash', () => {
	const groupId = 'group-no-node-test'
	replicaNodeByGroupId.delete(groupId)
	assertEquals(resolveGroupWsRoomKey(groupId), groupId)
})
