/**
 * 远端用户房间：B 主动加入 A 的用户房间（`fount-node-{A's nodeHash}`），
 * 建立单向 P2P 连接，用于 TrustGraph CAS fanout（非成员 emoji 拉取等）。
 *
 * - 幂等：同一 targetNodeHash 只建立一个房间连接。
 * - 注册 FederationRoomProvider，使 listFederationRoomSlots 能枚举远端用户房间。
 * - 注册 fed_chunk_get / fed_chunk_data handler，支持双向 chunk 传输。
 */
import { createHash } from 'node:crypto'

import { handleIncomingChunkGet, resolvePendingChunkFetch } from './files/chunk_fetch.mjs'
import { USER_ROOM_SCOPE } from './identity_announce.mjs'
import { attachMailboxWire } from './mailbox/wire.mjs'
import { joinMqttRoomWithDefaults } from './mqtt_room.mjs'
import { getNodeTransportSettings } from './node/identity.mjs'
import { attachPartWire } from './part_wire.mjs'
import { registerFederationRoomProvider } from './room_provider_registry.mjs'
import {
	attachIdentityAnnounceHandlers,
	createPeerIdentityMaps,
	createTrysteroActionRegistry,
	parseRelayUrls,
} from './trystero_session.mjs'

/**
 * @typedef {{
 *   roomSlot: import('./room_provider_registry.mjs').FederationRoomSlot
 *   leave: () => void | Promise<void>
 * }} RemoteUserRoomSlot
 */

/** @type {Map<string, RemoteUserRoomSlot | null>} nodeHash → slot（null 表示加入失败/进行中） */
const slots = new Map()
/** @type {Map<string, Promise<RemoteUserRoomSlot | null>>} nodeHash → inflight promise */
const inflights = new Map()

registerFederationRoomProvider('remote-user-room', () => {
	return [...slots.values()]
		.filter(Boolean)
		.map(s => s.roomSlot)
})

/**
 * 加入目标节点的用户房间（幂等）。
 * @param {string} username 本地 replica 用户名
 * @param {string} targetNodeHash 目标节点 64 hex
 * @returns {Promise<RemoteUserRoomSlot | null>} 房间槽
 */
export async function ensureRemoteUserRoom(username, targetNodeHash) {
	const key = targetNodeHash.toLowerCase()
	if (slots.has(key)) return slots.get(key) || null
	const existing = inflights.get(key)
	if (existing) return await existing

	const task = (async () => {
		const password = createHash('sha256').update(`fount-user-room:${key}`).digest('hex')
		const roomId = `fount-node-${key}`
		try {
			const room = await joinMqttRoomWithDefaults({
				appId: 'fount-user-fed',
				password,
				roomId,
				relayUrls: parseRelayUrls(getNodeTransportSettings()),
			})
			if (!room) {
				slots.set(key, null)
				return null
			}

			const maps = createPeerIdentityMaps()
			const actions = createTrysteroActionRegistry(room)
			attachIdentityAnnounceHandlers(room, maps, actions)

			const wireCtx = { replicaUsername: username }
			attachPartWire(wireCtx, actions)
			attachMailboxWire(wireCtx, actions)

			actions.on('fed_chunk_get', (data, peerId) => {
				void handleIncomingChunkGet(username, data, (resp) => {
					try { actions.send('fed_chunk_data', resp, peerId) }
					catch { /* peer disconnected */ }
				}, peerId)
			})
			actions.on('fed_chunk_data', (data) => {
				resolvePendingChunkFetch(data)
			})

			/** @type {import('./room_provider_registry.mjs').FederationRoomSlot} */
			const roomSlot = {
				groupId: USER_ROOM_SCOPE,
				/** @returns {Array<{ peerId: string, remoteNodeHash: string | undefined }>} roster */
				getRoster: () => maps.getRoster(),
				/**
				 * @param {string} nh 目标节点 64 hex
				 * @returns {string | null} peer id
				 */
				getPeerIdByNodeHash: nh => maps.getPeerIdByNodeHash(nh),
				/**
				 * @param {string} peerId 目标 peer
				 * @param {string} actionName Trystero action
				 * @param {unknown} payload 载荷
				 * @returns {void}
				 */
				sendToPeer(peerId, actionName, payload) {
					try { actions.send(actionName, payload, peerId) }
					catch { /* peer disconnected */ }
				},
			}

			const slot = {
				roomSlot,
				/** @returns {void | Promise<void>} 离开房间 */
				leave() { return room.leave?.() },
			}
			slots.set(key, slot)
			return slot
		}
		catch (error) {
			console.error('p2p: failed to join remote user room', key, error)
			slots.set(key, null)
			return null
		}
		finally {
			inflights.delete(key)
		}
	})()

	inflights.set(key, task)
	return await task
}

/**
 * 释放目标节点的远端用户房间连接。
 * @param {string} targetNodeHash 目标节点 64 hex
 * @returns {void}
 */
export function releaseRemoteUserRoom(targetNodeHash) {
	const key = targetNodeHash.toLowerCase()
	const slot = slots.get(key)
	if (slot) void Promise.resolve(slot.leave()).catch(() => {})
	slots.delete(key)
}
