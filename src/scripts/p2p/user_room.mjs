import { createHash } from 'node:crypto'

import { USER_ROOM_SCOPE } from './identity_announce.mjs'
import { listLinks, sendToNodeLink, subscribeScope, getLinkRegistry } from './link_registry.mjs'
import { attachMailboxWire } from './mailbox/wire.mjs'
import { ensureNodeDefaults, getNodeHash } from './node/identity.mjs'
import { attachPartWire } from './part_wire.mjs'
import { registerFederationRoomProvider } from './room_provider_registry.mjs'

/**
 * 在 TrysteroActionRegistry 上注册 fed_chunk_get / fed_chunk_data handler，
 * 供用户房间（本地 + 远端）双向 chunk 传输使用。
 * @param {string} username replica 用户名
 * @param {import('./trystero_session.mjs').TrysteroActionRegistry} actions action 表
 * @returns {void}
 */
function attachUserRoomChunkHandlers(username, wire) {
	import('./files/chunk_fetch.mjs').then(({ handleIncomingChunkGet, resolvePendingChunkFetch }) => {
		wire.on('fed_chunk_get', (data, peerId) => {
			void handleIncomingChunkGet(username, data, (resp) => {
				try { wire.send('fed_chunk_data', resp, peerId) }
				catch { /* disconnected */ }
			}, peerId)
		})
		wire.on('fed_chunk_data', data => {
			resolvePendingChunkFetch(data)
		})
	}).catch(error => console.error('p2p: failed to attach chunk handlers to node scope', error))
}

/** @type {Promise<UserRoomSlot | null> | null} */
let userRoomInflight = null

/** @type {UserRoomSlot | null} */
export let userRoomSlot = null

/** @type {Map<string, Set<(payload: unknown, peerId: string) => void>>} */
const nodeActionHandlers = new Map()
let nodeScopeCleanup = null

/**
 * @returns {{ on: (name: string, handler: (payload: unknown, peerId: string) => void) => void, send: (name: string, payload: unknown, peerId: string | null) => void }}
 */
function createNodeScopeWire() {
	return {
		on(name, handler) {
			const key = String(name)
			if (!nodeActionHandlers.has(key)) nodeActionHandlers.set(key, new Set())
			nodeActionHandlers.get(key).add(handler)
		},
		send(name, payload, peerId) {
			if (!peerId) return
			void sendToNodeLink(peerId, { scope: 'node', action: String(name), payload }).catch(() => {})
		},
	}
}

/**
 * @returns {Array<{ peerId: string, remoteNodeHash: string }>}
 */
function activeLinkRoster() {
	return listLinks().map(({ nodeHash }) => ({ peerId: nodeHash, remoteNodeHash: nodeHash }))
}

/**
 * @param {{ replicaUsername?: string }} ctx
 * @returns {Promise<void>}
 */
async function ensureNodeScopeRuntime(ctx) {
	if (nodeScopeCleanup) return
	nodeScopeCleanup = subscribeScope('node', (senderNodeHash, envelope) => {
		const handlers = nodeActionHandlers.get(String(envelope?.action || ''))
		if (!handlers?.size) return
		for (const handler of handlers)
			try { handler(envelope.payload, senderNodeHash) } catch { /* ignore */ }
	})
	const wire = createNodeScopeWire()
	attachPartWire({ replicaUsername: ctx.replicaUsername }, wire)
	attachMailboxWire({ replicaUsername: ctx.replicaUsername }, wire)
	attachUserRoomChunkHandlers(ctx.replicaUsername || '', wire)
}

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
		try {
			await ensureNodeScopeRuntime(ctx)
			const creds = resolveUserRoomCredentials()
			/** @type {UserRoomSlot} */
			userRoomSlot = {
				trysteroRoomName: creds.roomId,
				roomSecret: creds.password,
				room: null,
				sendToPeer(peerId, actionName, payload) {
					void sendToNodeLink(peerId, { scope: 'node', action: String(actionName), payload }).catch(() => {})
				},
				getRoster: () => activeLinkRoster(),
				getPeerIdByNodeHash(nodeHash) {
					return getLinkRegistry().getLink(nodeHash) ? String(nodeHash) : null
				},
			}
			return userRoomSlot
		}
		catch (error) {
			console.error('p2p: node scope init failed', error)
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
			if (await sendToNodeLink(peerId, { scope: 'node', action: String(actionName), payload: body }))
				sent++
			if (sent >= fanoutLimit) break
		}
		catch { /* disconnected */ }

	return sent
}
