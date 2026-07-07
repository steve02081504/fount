import { closeLink, ensureLinkToNode, getLink } from './link_registry.mjs'
import { registerFederationRoomProvider } from './room_provider_registry.mjs'
import { USER_ROOM_SCOPE } from './room_scopes.mjs'
import { invalidateTrustGraphCache } from './trust_graph_cache.mjs'

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
	void username
	const key = targetNodeHash.toLowerCase()
	if (slots.has(key)) return slots.get(key) || null
	const existing = inflights.get(key)
	if (existing) return await existing

	const task = (async () => {
		try {
			if (!await ensureLinkToNode(key)) {
				slots.set(key, null)
				return null
			}

			/** @type {import('./room_provider_registry.mjs').FederationRoomSlot} */
			const roomSlot = {
				groupId: USER_ROOM_SCOPE,
				/**
				 * 返回远端用户房间 roster（链路存在时含目标节点）。
				 * @returns {Array<{ peerId: string, remoteNodeHash: string }>} roster 列表
				 */
				getRoster: () => getLink(key) ? [{ peerId: key, remoteNodeHash: key }] : [],
				/**
				 * 按 nodeHash 查找 peer id。
				 * @param {string} nh 目标节点 64 hex
				 * @returns {string | null} peer id；无链路时 null
				 */
				getPeerIdByNodeHash: nh => getLink(nh) ? String(nh) : null,
				/**
				 * 经 node scope 向远端 peer 发送 action。始终走当前规范链路（`getLink`），
				 * 因为 glare 双 PC 择一后最初返回的链路可能已被关闭，规范链在 registry 内。
				 * @param {string} peerId 目标 peer id
				 * @param {string} actionName action 名称
				 * @param {unknown} payload 载荷
				 * @returns {void}
				 */
				sendToPeer(peerId, actionName, payload) {
					void getLink(key)?.send({ scope: 'node', action: String(actionName), payload }).catch(() => {})
				},
			}

			const slot = {
				roomSlot,
				/**
				 * 关闭远端用户房间链路。
				 * @returns {Promise<void>} 关闭完成
				 */
				leave() { return closeLink(key, 'remote-user-room-release') },
			}
			slots.set(key, slot)
			invalidateTrustGraphCache()
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
