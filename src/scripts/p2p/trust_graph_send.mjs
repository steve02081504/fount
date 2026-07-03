import { isHex64, normalizeHex64 } from './hexIds.mjs'
import { USER_ROOM_SCOPE } from './identity_announce.mjs'
import { getNodeHash } from './node/identity.mjs'
import { isQuarantinedPure } from './reputation_engine.mjs'
import { loadReputation } from './reputation_store.mjs'
import { listFederationRoomSlots } from './room_provider_registry.mjs'
import trustGraphTunables from './trust_graph.tunables.json' with { type: 'json' }
import { buildMergedGraph } from './trust_graph_build.mjs'
import { pickTopFromGraph } from './trust_graph_engine.mjs'
import { resolveFederationFanoutTopK } from './tunables_resolve.mjs'
import { ensureUserRoom } from './user_room.mjs'

/**
 * @param {string} username replica 登录名
 * @param {string} targetNodeHash 64 hex
 * @param {string} actionName Trystero action
 * @param {unknown} payload 载荷
 * @param {Map<string, object>} [graph] 已构建信任图（省略时内部构建）
 * @returns {Promise<boolean>} 是否已发送
 */
export async function sendToNode(username, targetNodeHash, actionName, payload, graph) {
	const target = normalizeHex64(targetNodeHash) || String(targetNodeHash || '').trim().toLowerCase()
	if (!isHex64(target)) return false
	await ensureUserRoom({ replicaUsername: username })
	const merged = graph ?? await buildMergedGraph(username)
	const targetNode = merged.get(target)
	if (!targetNode?.scopeIds.length) return false
	const selfNodeHash = getNodeHash()

	const rooms = await listFederationRoomSlots(username)
	const userRooms = rooms.filter(room => room.groupId === USER_ROOM_SCOPE)
	const groupRooms = rooms.filter(room => room.groupId !== USER_ROOM_SCOPE)

	for (const userRoom of userRooms) {
		const peerId = userRoom.getPeerIdByNodeHash(target)
		if (peerId) {
			userRoom.sendToPeer(peerId, actionName, payload)
			return true
		}
	}

	for (const room of groupRooms) {
		if (!targetNode.scopeIds.includes(room.groupId)) continue
		const peerId = room.getPeerIdByNodeHash(targetNodeHash)
		if (peerId) {
			room.sendToPeer(peerId, actionName, payload)
			return true
		}
		if (room.pickFallbackPeerIds) {
			const targets = await room.pickFallbackPeerIds(selfNodeHash)
			if (targets.length) {
				for (const targetPeerId of targets.slice(0, trustGraphTunables.sendFallbackPeerLimit))
					room.sendToPeer(targetPeerId, actionName, payload)
				return true
			}
		}
	}
	return false
}

/**
 * @param {string} username replica 登录名
 * @param {string} actionName action 名
 * @param {unknown} payload 载荷
 * @param {number} [limit] K（省略时按 roster 规模缩放）
 * @returns {Promise<number>} 发送次数
 */
export async function fanoutToTopNodes(username, actionName, payload, limit) {
	await ensureUserRoom({ replicaUsername: username })
	const graph = await buildMergedGraph(username)
	const k = limit ?? resolveFederationFanoutTopK(graph.size, trustGraphTunables)
	const rep = loadReputation()
	const quarantined = new Set(
		Object.keys(rep.byNodeHash || {}).filter(id => isQuarantinedPure(rep, id)),
	)
	const topNodes = pickTopFromGraph(graph, k, trustGraphTunables, quarantined)
	let sent = 0
	for (const { nodeHash } of topNodes)
		if (await sendToNode(username, nodeHash, actionName, payload, graph)) sent++
	return sent
}
