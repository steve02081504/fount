import { USER_ROOM_SCOPE } from './identity_announce.mjs'
import { closeLink, ensureLinkToNode, getLink } from './link_registry.mjs'
import { registerFederationRoomProvider } from './room_provider_registry.mjs'

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
			const link = await ensureLinkToNode(key)
			if (!link) {
				slots.set(key, null)
				return null
			}

			/** @type {import('./room_provider_registry.mjs').FederationRoomSlot} */
			const roomSlot = {
				groupId: USER_ROOM_SCOPE,
				getRoster: () => getLink(key) ? [{ peerId: key, remoteNodeHash: key }] : [],
				getPeerIdByNodeHash: nh => getLink(nh) ? String(nh) : null,
				sendToPeer(peerId, actionName, payload) {
					void link.send({ scope: 'node', action: String(actionName), payload }).catch(() => {})
				},
			}

			const slot = {
				roomSlot,
				leave() { return closeLink(key, 'remote-user-room-release') },
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
