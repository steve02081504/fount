import { createHash } from 'node:crypto'

import {
	USER_ROOM_SCOPE,
} from './identity_announce.mjs'
import { attachMailboxWire } from './mailbox/wire.mjs'
import { joinMqttRoomWithDefaults, leaveMqttRoom } from './mqtt_room.mjs'
import { recordExplorePeersFromRoster } from './network.mjs'
import { ensureNodeDefaults, getNodeHash, getNodeTransportSettings } from './node/identity.mjs'
import { attachPartWire } from './part_wire.mjs'
import { registerFederationRoomProvider } from './room_provider_registry.mjs'
import {
	attachIdentityAnnounceHandlers,
	createPeerIdentityMaps,
	createTrysteroActionRegistry,
	parseRelayUrls,
} from './trystero_session.mjs'

/** @type {Promise<UserRoomSlot | null> | null} */
let userRoomInflight = null

/** @type {UserRoomSlot | null} */
export let userRoomSlot = null

/**
 * 用户级 Trystero 房间（`fount-node-{nodeHash}`），单节点单实例。
 *
 * @typedef {{
 *   trysteroRoomName: string
 *   mqttPassword: string
 *   room: object
 *   sendToPeer: (peerId: string, actionName: string, payload: unknown) => void
 *   getRoster: () => Array<{ peerId: string, remoteNodeHash: string | undefined }>
 *   getPeerIdByNodeHash: (nodeHash: string) => string | null
 * }} UserRoomSlot
 */

registerFederationRoomProvider('user-room', () => {
	if (!userRoomSlot) return []
	return [{
		groupId: USER_ROOM_SCOPE,
		/**
		 *
		 */
		getRoster: () => userRoomSlot.getRoster(),
		/**
		 *
		 * @param nodeHash
		 */
		getPeerIdByNodeHash: nodeHash => userRoomSlot.getPeerIdByNodeHash(nodeHash),
		/**
		 *
		 * @param peerId
		 * @param actionName
		 * @param payload
		 */
		sendToPeer: (peerId, actionName, payload) => userRoomSlot.sendToPeer(peerId, actionName, payload),
	}]
})

/**
 * @returns {{ appId: string, password: string, roomId: string, nodeHash: string }} Trystero 参数
 */
export function resolveUserMqttCredentials() {
	const nodeHash = getNodeHash()
	const password = createHash('sha256').update(`fount-user-room:${nodeHash}`).digest('hex')
	return {
		appId: 'fount-user-fed',
		password,
		roomId: `fount-node-${nodeHash}`,
		nodeHash,
	}
}

/**
 * @param {{ replicaUsername?: string }} [ctx] 入站上下文（part/mailbox 派发用）
 * @returns {Promise<UserRoomSlot | null>} 用户级联邦房间槽
 */
export async function ensureUserRoom(ctx = {}) {
	if (userRoomSlot) return userRoomSlot
	if (userRoomInflight) return await userRoomInflight

	userRoomInflight = (async () => {
		ensureNodeDefaults()
		const creds = resolveUserMqttCredentials()
		try {
			const room = await joinMqttRoomWithDefaults({
				appId: creds.appId,
				password: creds.password,
				roomId: creds.roomId,
				relayUrls: parseRelayUrls(getNodeTransportSettings()),
			})

			const maps = createPeerIdentityMaps()
			const actions = createTrysteroActionRegistry(room)
			attachIdentityAnnounceHandlers(room, maps, actions)

			/** @type {UserRoomSlot} */
			const slot = {
				trysteroRoomName: creds.roomId,
				mqttPassword: creds.password,
				room,
				/**
				 *
				 * @param peerId
				 * @param actionName
				 * @param payload
				 */
				sendToPeer(peerId, actionName, payload) {
					try { actions.send(actionName, payload, peerId) }
					catch { /* disconnected */ }
				},
				/**
				 *
				 */
				getRoster: () => maps.getRoster(),
				/**
				 *
				 * @param nodeHash
				 */
				getPeerIdByNodeHash: nodeHash => maps.getPeerIdByNodeHash(nodeHash),
			}

			const wireCtx = { replicaUsername: ctx.replicaUsername }
			attachPartWire(wireCtx, actions)
			attachMailboxWire(wireCtx, actions)
			userRoomSlot = slot
			recordExplorePeersFromRoster(slot.getRoster(), '', 'user_room')
			return slot
		}
		catch (error) {
			console.error('p2p: user room join failed', error)
			userRoomSlot = null
			return null
		}
		finally {
			userRoomInflight = null
		}
	})()

	return await userRoomInflight
}

/**
 * @returns {void}
 */
export function invalidateUserRoom() {
	const slot = userRoomSlot
	if (slot?.room && typeof slot.room.leave === 'function')
		void Promise.resolve(leaveMqttRoom(slot.room)).catch(error => console.error('p2p: user room leave failed', error))
	userRoomSlot = null
	userRoomInflight = null
}
