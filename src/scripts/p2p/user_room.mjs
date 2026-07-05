import { createHash } from 'node:crypto'

import { listLinks, sendToNodeLink, subscribeScope, getLinkRegistry } from './link_registry.mjs'
import { attachMailboxWire } from './mailbox/wire.mjs'
import { ensureNodeDefaults, getNodeHash } from './node/identity.mjs'
import { attachPartWire } from './part_wire_ingress.mjs'
import { registerFederationRoomProvider } from './room_provider_registry.mjs'
import { USER_ROOM_SCOPE } from './room_scopes.mjs'

/**
 * 在 node scope action 表上注册 fed_chunk_get / fed_chunk_data handler，
 * 供用户房间（本地 + 远端）双向 chunk 传输使用。
 * @param {string} username replica 用户名
 * @param {{ on: (name: string, handler: (payload: unknown, peerId: string) => void) => void, send: (name: string, payload: unknown, peerId: string | null) => void }} wire action 表
 * @returns {void}
 */
function attachUserRoomChunkHandlers(username, wire) {
	import('./files/chunk_responder.mjs').then(({ attachNodeScopeFedChunkResponder }) => {
		attachNodeScopeFedChunkResponder(username, wire)
	}).catch(error => console.error('p2p: failed to attach chunk handlers to node scope', error))
}

/** @type {Promise<UserRoomSlot | null> | null} */
let userRoomInflight = null

/** @type {UserRoomSlot | null} */
export let userRoomSlot = null

/** @type {Map<string, Set<(payload: unknown, peerId: string) => void>>} */
const nodeActionHandlers = new Map()
/** @type {Set<(username: string, wire: { on: (name: string, handler: (payload: unknown, peerId: string) => void) => void, send: (name: string, payload: unknown, peerId: string | null) => void }) => void>} */
const nodeScopeWireHooks = new Set()
/** @type {string} */
let nodeScopeReplicaUsername = ''
/** @type {ReturnType<typeof createNodeScopeWire> | null} */
let nodeScopeWire = null
let nodeScopeCleanup = null

/**
 * Chat 等非 P2P 模块可向 node scope 注册 fed_emoji 等 handler（避免 p2p→shell 硬依赖）。
 * @param {(username: string, wire: { on: (name: string, handler: (payload: unknown, peerId: string) => void) => void, send: (name: string, payload: unknown, peerId: string | null) => void }) => void} hook 注册回调
 * @returns {() => void} 取消注册
 */
export function registerUserRoomNodeScopeHook(hook) {
	nodeScopeWireHooks.add(hook)
	if (nodeScopeWire)
		try { hook(nodeScopeReplicaUsername, nodeScopeWire) } catch { /* ignore */ }
	return () => nodeScopeWireHooks.delete(hook)
}

/**
 * 创建 node scope 的 on/send wire 表。
 * @returns {{ on: (name: string, handler: (payload: unknown, peerId: string) => void) => void, send: (name: string, payload: unknown, peerId: string | null) => void }} wire 接口
 */
function createNodeScopeWire() {
	return {
		/**
		 * 注册 node scope action handler。
		 * @param {string} name action 名称
		 * @param {(payload: unknown, peerId: string) => void} handler 入站回调
		 * @returns {void}
		 */
		on(name, handler) {
			const key = String(name)
			if (!nodeActionHandlers.has(key)) nodeActionHandlers.set(key, new Set())
			nodeActionHandlers.get(key).add(handler)
		},
		/**
		 * 向指定 peer 发送 node scope action。
		 * @param {string} name action 名称
		 * @param {unknown} payload 载荷
		 * @param {string | null} peerId 目标 peer id
		 * @returns {void}
		 */
		send(name, payload, peerId) {
			if (!peerId) return
			void sendToNodeLink(peerId, { scope: 'node', action: String(name), payload }).catch(() => {})
		},
	}
}

/**
 * 返回当前所有活跃链路的 roster。
 * @returns {Array<{ peerId: string, remoteNodeHash: string }>} 在线 peer 列表
 */
function activeLinkRoster() {
	return listLinks().map(({ nodeHash }) => ({ peerId: nodeHash, remoteNodeHash: nodeHash }))
}

/**
 * 初始化 node scope 订阅与 wire 派发（幂等）。
 * @param {{ replicaUsername?: string }} ctx 入站上下文
 * @returns {Promise<void>}
 */
async function ensureNodeScopeRuntime(ctx) {
	if (nodeScopeCleanup) return
	nodeScopeReplicaUsername = String(ctx.replicaUsername || nodeScopeReplicaUsername || '')
	nodeScopeCleanup = subscribeScope('node', (senderNodeHash, envelope) => {
		const handlers = nodeActionHandlers.get(String(envelope?.action || ''))
		if (!handlers?.size) return
		for (const handler of handlers)
			try { handler(envelope.payload, senderNodeHash) } catch { /* ignore */ }
	})
	const wire = createNodeScopeWire()
	nodeScopeWire = wire
	attachPartWire({ replicaUsername: ctx.replicaUsername }, wire)
	attachMailboxWire({ replicaUsername: ctx.replicaUsername }, wire)
	attachUserRoomChunkHandlers(ctx.replicaUsername || '', wire)
	for (const hook of nodeScopeWireHooks)
		try { hook(ctx.replicaUsername || '', wire) } catch { /* ignore */ }
}

/**
 * 用户级 node scope 房间（`fount-node-{nodeHash}`），单节点单实例。
 *
 * @typedef {{
 *   roomId: string
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
		 * @param {string} actionName node scope action
		 * @param {unknown} payload 载荷
		 * @returns {void}
		 */
		sendToPeer: (peerId, actionName, payload) => userRoomSlot.sendToPeer(peerId, actionName, payload),
	}]
})

/**
 * @returns {{ appId: string, password: string, roomId: string, nodeHash: string }} 用户房间参数
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
			await getLinkRegistry().ensureRuntime()
			await ensureNodeScopeRuntime(ctx)
			const creds = resolveUserRoomCredentials()
			/** @type {UserRoomSlot} */
			userRoomSlot = {
				roomId: creds.roomId,
				roomSecret: creds.password,
				room: null,
				/**
				 * 经 node scope 向 peer 发送 action。
				 * @param {string} peerId 目标 peer id
				 * @param {string} actionName action 名称
				 * @param {unknown} payload 载荷
				 * @returns {void}
				 */
				sendToPeer(peerId, actionName, payload) {
					void sendToNodeLink(peerId, { scope: 'node', action: String(actionName), payload }).catch(() => {})
				},
				/**
				 * 返回当前活跃链路 roster。
				 * @returns {Array<{ peerId: string, remoteNodeHash: string }>} 在线 peer 列表
				 */
				getRoster: () => activeLinkRoster(),
				/**
				 * 按 nodeHash 查找 peer id。
				 * @param {string} nodeHash 目标节点 64 hex
				 * @returns {string | null} peer id；无链路时 null
				 */
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
	nodeScopeWire = null
	nodeScopeReplicaUsername = ''
	nodeScopeCleanup = null
}

/**
 * @param {string} username replica
 * @param {string} actionName node scope action
 * @param {unknown} payload 载荷
 * @param {string | null} [exceptPeerId] 跳过的 peer
 * @param {number} [limit] 最多转发 peer 数
 * @returns {Promise<number>} 实际转发的 peer 数
 */
export async function deliverToUserRoomPeers(username, actionName, payload, exceptPeerId = null, limit) {
	const { USER_ROOM_PEER_FANOUT_DEFAULT } = await import('./part_wire_common.mjs')
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
