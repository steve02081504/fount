/**
 * 联邦 slot 凭证映射回归：resolveGroupRoomCredentials 返回扁平 { roomId, password }，
 * buildFederationSlot 必须经 federationSlotCredParams 读 flat roomId（嵌套 roomCreds.roomCreds 会 TypeError）。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { buildFederationSlot } from '../../src/chat/federation/federationSlot.mjs'
import { FEDERATION_WIRE_ACTION_NAMES } from '../../src/chat/federation/federationWireActions.mjs'
import { federationSlotCredParams } from '../../src/chat/federation/roomCredentials.mjs'

/** 占位 no-op sender。 */
function noopSender() { }

/**
 * @returns {Map<string, Function>} 占位 sender 表
 */
function stubSenderRegistry() {
	const registry = new Map()
	for (const name of FEDERATION_WIRE_ACTION_NAMES)
		registry.set(name, noopSender)
	return registry
}

/** @returns {object} 空 peers 快照 */
function emptyPeers() {
	return {}
}

/** 占位 fedOut enqueue。 */
function noopEnqueue() { }

Deno.test('federationSlotCredParams maps flat resolveGroupRoomCredentials shape', () => {
	assertEquals(federationSlotCredParams({
		appId: 'fount-group-fed',
		password: 'room-secret',
		roomId: 'fount-fed-g1:sync',
		source: 'dag',
	}), {
		roomId: 'fount-fed-g1:sync',
		roomSecret: 'room-secret',
	})
})

Deno.test('buildFederationSlot stores federationSlotCredParams output', () => {
	const slotCreds = federationSlotCredParams({
		appId: 'fount-group-fed',
		password: 'room-secret',
		roomId: 'fount-fed-g1:sync',
		source: 'dag',
	})
	const senderRegistry = stubSenderRegistry()
	/**
	 * @param {string} name action 名
	 * @returns {Function | undefined} sender
	 */
	function getActionSender(name) {
		return senderRegistry.get(name)
	}
	const slot = buildFederationSlot({
		partitionId: 'sync',
		roomId: slotCreds.roomId,
		room: { getPeers: emptyPeers },
		roomSecret: slotCreds.roomSecret,
		groupId: 'g1',
		roomKey: 'u:g1:sync',
		rtcLimits: { maxActive: 8, maxJoinsPerMin: 4, trustedPeers: [] },
		fedOut: { enqueue: noopEnqueue },
		peerToNode: new Map(),
		nodeToPeer: new Map(),
		getActionSender,
		senderRegistry,
	})
	assertEquals(slot.roomId, 'fount-fed-g1:sync')
	assertEquals(slot.roomSecret, 'room-secret')
})
