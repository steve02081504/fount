/**
 * 联邦 slot 凭证映射回归：resolveGroupRoomCredentials 返回扁平 { roomId, password }，
 * buildFederationSlot 必须读 roomCreds.roomId（嵌套 roomCreds.roomCreds 会在 join 时 TypeError）。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { buildFederationSlot } from '../../src/chat/federation/federationSlot.mjs'
import { FEDERATION_WIRE_ACTION_NAMES } from '../../src/chat/federation/federationWireActions.mjs'

/**
 * @returns {{ roomId: string, password: string, appId: string, source: string }} 扁平凭证（与 resolveGroupRoomCredentials 同形）
 */
function sampleResolvedRoomCreds() {
	return {
		appId: 'fount-group-fed',
		password: 'room-secret',
		roomId: 'fount-fed-g1:sync',
		source: 'dag',
	}
}

/**
 * @returns {Map<string, Function>} 占位 sender 表
 */
function stubSenderRegistry() {
	const noop = () => { }
	const registry = new Map()
	for (const name of FEDERATION_WIRE_ACTION_NAMES)
		registry.set(name, noop)
	return registry
}

Deno.test('resolveGroupRoomCredentials shape has flat roomId (nested access throws)', () => {
	const roomCreds = sampleResolvedRoomCreds()
	assertEquals(roomCreds.roomId, 'fount-fed-g1:sync')
	let nestedError = null
	try {
		void roomCreds.roomCreds.roomId
	}
	catch (error) {
		nestedError = error
	}
	assert(nestedError instanceof TypeError)
	assertEquals(/** @type {TypeError} */(nestedError).message.includes('roomId'), true)
})

Deno.test('buildFederationSlot stores flat roomCreds.roomId', () => {
	const roomCreds = sampleResolvedRoomCreds()
	const senderRegistry = stubSenderRegistry()
	const slot = buildFederationSlot({
		partitionId: 'sync',
		roomId: roomCreds.roomId,
		room: { getPeers: () => ({}) },
		roomSecret: roomCreds.password,
		groupId: 'g1',
		roomKey: 'u:g1:sync',
		rtcLimits: { maxActive: 8, maxJoinsPerMin: 4, trustedPeers: [] },
		fedOut: { enqueue: () => { } },
		peerToNode: new Map(),
		nodeToPeer: new Map(),
		getActionSender: name => senderRegistry.get(name),
		senderRegistry,
	})
	assertEquals(slot.roomId, 'fount-fed-g1:sync')
	assertEquals(slot.roomSecret, 'room-secret')
})

Deno.test('ensureFederationPartitionRoom passes flat roomCreds.roomId (not nested roomCreds)', async () => {
	const source = await Deno.readTextFile(new URL('../../src/chat/federation/room.mjs', import.meta.url))
	assert(
		!source.includes('roomCreds.roomCreds'),
		'joinSignalingRoom must not read roomCreds.roomCreds.roomId (TypeError; empty federated group after invite join)',
	)
	assert(
		/roomId:\s*roomCreds\.roomId\b/.test(source) || /\bconst roomId = roomCreds\.roomId\b/.test(source),
		'buildFederationSlot roomId must come from flat roomCreds.roomId',
	)
})
