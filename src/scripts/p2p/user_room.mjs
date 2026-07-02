import { createHash } from 'node:crypto'

import {
	USER_ROOM_SCOPE,
} from './identity_announce.mjs'
import { attachMailboxWire } from './mailbox/wire.mjs'
import { recordExplorePeersFromRoster } from './network.mjs'
import { ensureNodeDefaults, getNodeHash, getNodeTransportSettings } from './node/identity.mjs'
import { attachPartWire } from './part_wire.mjs'
import { registerFederationRoomProvider } from './room_provider_registry.mjs'
import { joinSignalingRoomWithDefaults, leaveSignalingRoom } from './signaling_room.mjs'
import { recordStalePeerPrune } from './stale_peer_log.mjs'
import {
	attachIdentityAnnounceHandlers,
	createPeerIdentityMaps,
	createTrysteroActionRegistry,
	parseRelayUrls,
} from './trystero_session.mjs'

/**
 * 在 TrysteroActionRegistry 上注册 fed_chunk_get / fed_chunk_data handler，
 * 供用户房间（本地 + 远端）双向 chunk 传输使用。
 * @param {string} username replica 用户名
 * @param {import('./trystero_session.mjs').TrysteroActionRegistry} actions action 表
 * @returns {void}
 */
function attachUserRoomChunkHandlers(username, actions) {
	import('./files/chunk_fetch.mjs').then(({ handleIncomingChunkGet, resolvePendingChunkFetch }) => {
		actions.on('fed_chunk_get', (data, peerId) => {
			void handleIncomingChunkGet(username, data, (resp) => {
				try { actions.send('fed_chunk_data', resp, peerId) }
				catch { /* peer disconnected */ }
			}, peerId)
		})
		actions.on('fed_chunk_data', (data) => {
			resolvePendingChunkFetch(data)
		})
	}).catch(error => console.error('p2p: failed to attach chunk handlers to user room', error))
}

/** @type {Promise<UserRoomSlot | null> | null} */
let userRoomInflight = null

/** @type {UserRoomSlot | null} */
export let userRoomSlot = null

/**
 * 用户级 Trystero 房间（`fount-node-{nodeHash}`），单节点单实例。
 *
 * @typedef {{
 *   trysteroRoomName: string
 *   roomSecret: string
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
		/** @returns {Array<{ peerId: string, remoteNodeHash: string | undefined }>} 房间 roster */
		getRoster: () => userRoomSlot.getRoster(),
		/**
		 * @param {string} nodeHash 64 hex
		 * @returns {string | null} peer id
		 */
		getPeerIdByNodeHash: nodeHash => userRoomSlot.getPeerIdByNodeHash(nodeHash),
		/**
		 * @param {string} peerId 目标 peer
		 * @param {string} actionName Trystero action
		 * @param {unknown} payload 载荷
		 * @returns {void}
		 */
		sendToPeer: (peerId, actionName, payload) => userRoomSlot.sendToPeer(peerId, actionName, payload),
	}]
})

/**
 * @returns {{ appId: string, password: string, roomId: string, nodeHash: string }} Trystero 参数
 */
export function resolveUserRoomCredentials() {
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
		const creds = resolveUserRoomCredentials()
		try {
			const room = await joinSignalingRoomWithDefaults({
				appId: creds.appId,
				password: creds.password,
				roomId: creds.roomId,
				relayUrls: parseRelayUrls(getNodeTransportSettings()),
			})
			if (!room) {
				console.error('p2p: user room join failed (timeout or signaling error)')
				return null
			}
			const maps = createPeerIdentityMaps({
				/** @returns {string[]} 当前活连接 peerId */
				getLivePeerIds: () => Object.keys(room.getPeers?.() || {}),
				/**
				 * @param {Array<{ peerId: string, remoteNodeHash?: string }>} stale 被剔除的失效条目
				 * @returns {void}
				 */
				onStalePruned: stale => recordStalePeerPrune('user_room', stale, { room: 'user_room' }),
			})
			const actions = createTrysteroActionRegistry(room)
			attachIdentityAnnounceHandlers(room, maps, actions)

			/** @type {UserRoomSlot} */
			const slot = {
				trysteroRoomName: creds.roomId,
				roomSecret: creds.password,
				room,
				/**
				 * @param {string} peerId 目标 peer
				 * @param {string} actionName Trystero action
				 * @param {unknown} payload 载荷
				 * @returns {void}
				 */
				sendToPeer(peerId, actionName, payload) {
					try { actions.send(actionName, payload, peerId) }
					catch { /* disconnected */ }
				},
				/** @returns {Array<{ peerId: string, remoteNodeHash: string | undefined }>} 房间 roster */
				getRoster: () => maps.getRoster(),
				/**
				 * @param {string} nodeHash 64 hex
				 * @returns {string | null} peer id
				 */
				getPeerIdByNodeHash: nodeHash => maps.getPeerIdByNodeHash(nodeHash),
			}

			const wireCtx = { replicaUsername: ctx.replicaUsername }
			attachPartWire(wireCtx, actions)
			attachMailboxWire(wireCtx, actions)
			attachUserRoomChunkHandlers(ctx.replicaUsername || '', actions)
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
		void Promise.resolve(leaveSignalingRoom(slot.room)).catch(error => console.error('p2p: user room leave failed', error))
	userRoomSlot = null
	userRoomInflight = null
}

/**
 * @param {string} username replica
 * @param {string} actionName Trystero action
 * @param {unknown} payload 载荷
 * @param {string | null} [exceptPeerId] 跳过的 peer
 * @param {number} [limit] 最多转发 peer 数
 * @returns {Promise<number>} 实际转发的 peer 数
 */
export async function deliverToUserRoomPeers(username, actionName, payload, exceptPeerId = null, limit) {
	const { USER_ROOM_PEER_FANOUT_DEFAULT } = await import('./part_wire.mjs')
	const fanoutLimit = limit ?? USER_ROOM_PEER_FANOUT_DEFAULT
	const slot = await ensureUserRoom({ replicaUsername: username })
	if (!slot) return 0
	const body = { ...payload, nodeHash: getNodeHash() }
	let sent = 0
	const peers = [...slot.getRoster()
		.filter(({ peerId }) => peerId && peerId !== exceptPeerId)]
	for (let swapIndex = peers.length - 1; swapIndex > 0; swapIndex--) {
		const pickIndex = Math.floor(Math.random() * (swapIndex + 1))
		const tmp = peers[swapIndex]
		peers[swapIndex] = peers[pickIndex]
		peers[pickIndex] = tmp
	}
	for (const { peerId } of peers)
		try {
			slot.sendToPeer(peerId, actionName, body)
			sent++
			if (sent >= fanoutLimit) break
		}
		catch { /* disconnected */ }

	return sent
}
