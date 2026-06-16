import { createHash } from 'node:crypto'

import { getFederationSettings } from './federation/identity.mjs'
import {
	USER_ROOM_SCOPE,
} from './identity_announce.mjs'
import { attachMailboxWire } from './mailbox/wire.mjs'
import { joinMqttRoomWithDefaults, leaveMqttRoom } from './mqtt_room.mjs'
import { recordExplorePeersFromRoster } from './network.mjs'
import { getNodeHash } from './node_context.mjs'
import { attachPartWire } from './part_wire.mjs'
import { registerFederationRoomProvider } from './room_provider_registry.mjs'
import {
	attachIdentityAnnounceHandlers,
	createPeerIdentityMaps,
	createTrysteroActionRegistry,
	parseRelayUrls,
} from './trystero_session.mjs'

/** @type {Map<string, Promise<UserRoomSlot | null>>} */
const userRoomInflight = new Map()

/** @type {Map<string, UserRoomSlot | null>} */
export const userRooms = new Map()

/**
 * 用户级 Trystero 房间（`fount-node-{nodeHash}`）。
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

registerFederationRoomProvider('user-room', username => {
	const slot = userRooms.get(username)
	if (!slot) return []
	return [{
		groupId: USER_ROOM_SCOPE,
		/** @returns {Array<{ peerId: string, remoteNodeHash: string | undefined }>} roster */
		getRoster: () => slot.getRoster(),
		/**
		 * @param {string} nodeHash 64 hex
		 * @returns {string | null} peer id
		 */
		getPeerIdByNodeHash: nodeHash => slot.getPeerIdByNodeHash(nodeHash),
		/**
		 * @param {string} peerId Trystero peer
		 * @param {string} actionName action
		 * @param {unknown} payload 载荷
		 * @returns {void}
		 */
		sendToPeer: (peerId, actionName, payload) => slot.sendToPeer(peerId, actionName, payload),
	}]
})

/**
 * @param {string} username replica 登录名
 * @returns {{ appId: string, password: string, roomId: string, nodeHash: string }} Trystero 参数
 */
export function resolveUserMqttCredentials(username) {
	const nodeHash = getNodeHash(username)
	const password = createHash('sha256').update(`fount-user-room:${nodeHash}`).digest('hex')
	return {
		appId: 'fount-user-fed',
		password,
		roomId: `fount-node-${nodeHash}`,
		nodeHash,
	}
}

/**
 * @param {string} username replica 登录名
 * @returns {Promise<UserRoomSlot | null>} 用户级联邦房间槽
 */
export async function ensureUserRoom(username) {
	if (userRooms.has(username)) return userRooms.get(username)
	if (userRoomInflight.has(username)) return await userRoomInflight.get(username)

	const joinTask = (async () => {
		const creds = resolveUserMqttCredentials(username)
		try {
			const room = await joinMqttRoomWithDefaults({
				appId: creds.appId,
				password: creds.password,
				roomId: creds.roomId,
				relayUrls: parseRelayUrls(getFederationSettings(username)),
			})

			const maps = createPeerIdentityMaps()
			const actions = createTrysteroActionRegistry(room)
			attachIdentityAnnounceHandlers(room, username, maps, actions)

			/** @type {UserRoomSlot} */
			const slot = {
				trysteroRoomName: creds.roomId,
				mqttPassword: creds.password,
				room,
				/**
				 * @param {string} peerId Trystero peer
				 * @param {string} actionName action
				 * @param {unknown} payload 载荷
				 * @returns {void}
				 */
				sendToPeer(peerId, actionName, payload) {
					try { actions.send(actionName, payload, peerId) }
					catch { /* disconnected */ }
				},
				/** @returns {Array<{ peerId: string, remoteNodeHash: string | undefined }>} roster */
				getRoster: () => maps.getRoster(),
				/**
				 * @param {string} nodeHash 64 hex
				 * @returns {string | null} peer id
				 */
				getPeerIdByNodeHash: nodeHash => maps.getPeerIdByNodeHash(nodeHash),
			}

			attachPartWire(username, actions)
			attachMailboxWire(username, actions)
			userRooms.set(username, slot)
			recordExplorePeersFromRoster(username, slot.getRoster(), '', 'user_room')
			return slot
		}
		catch (error) {
			console.error('p2p: user room join failed', error)
			userRooms.set(username, null)
			return null
		}
		finally {
			userRoomInflight.delete(username)
		}
	})()

	userRoomInflight.set(username, joinTask)
	return await joinTask
}
/**
 * @param {string} username replica 登录名
 * @returns {void}
 */
export function invalidateUserRoom(username) {
	// 删 Map 前 best-effort leave 底层 Trystero 房间，否则旧 user room 成为孤儿持连泄漏。
	const slot = userRooms.get(username)
	if (slot?.room && typeof slot.room.leave === 'function')
		void Promise.resolve(leaveMqttRoom(slot.room)).catch(error => console.error('p2p: user room leave failed', error))
	userRooms.delete(username)
	userRoomInflight.delete(username)
}
