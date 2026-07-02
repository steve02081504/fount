import { isPeerKeyBlocked, isSubjectBlocked } from './denylist.mjs'
import { isHex64, normalizeHex64 } from './hexIds.mjs'
import { USER_ROOM_SCOPE } from './identity_announce.mjs'
import { loadNetwork } from './network.mjs'
import { getNodeHash } from './node/identity.mjs'
import { isQuarantinedPure } from './reputation_engine.mjs'
import { loadReputation } from './reputation_store.mjs'
import { listFederationRoomSlots } from './room_provider_registry.mjs'
import trustGraphTunables from './trust_graph.tunables.json' with { type: 'json' }
import { getCachedTrustGraph } from './trust_graph_cache.mjs'
import { mergeGraph, pickTopFromGraph } from './trust_graph_engine.mjs'
import { resolveFederationFanoutTopK } from './tunables_resolve.mjs'
import { ensureUserRoom } from './user_room.mjs'

/**
 * @typedef {import('./trust_graph_engine.mjs').TrustNode} TrustNode
 */

/**
 * @param {string} nodeHash 64 hex
 * @returns {boolean} 是否拉黑
 */
function isNodeBlocked(nodeHash) {
	return isPeerKeyBlocked('', nodeHash) || isSubjectBlocked({ nodeHash })
}

/**
 * @param {string} username replica 登录名（联邦房间枚举仍按用户）
 * @returns {Promise<Map<string, TrustNode>>} nodeHash → 节点
 */
export async function buildMergedGraph(username) {
	return getCachedTrustGraph(async () => {
		const net = loadNetwork()
		const rep = loadReputation()
		const blocked = new Set()
		const quarantined = new Set()
		for (const nodeHash of [...net.trustedPeers, ...net.explorePeers, ...net.hints.map(h => h.nodeHash)]) {
			if (isNodeBlocked(nodeHash)) blocked.add(nodeHash)
			if (isQuarantinedPure(rep, nodeHash)) quarantined.add(nodeHash)
		}

		/**
		 * @param {string} nodeHash 64 hex
		 * @returns {number} 信誉分
		 */
		function scoreOf(nodeHash) {
			return Number(rep.byNodeHash?.[nodeHash]?.score ?? 0)
		}

		const rooms = await listFederationRoomSlots(username)
		/** @type {import('./trust_graph_engine.mjs').TrustGraphInputs['roomRosters']} */
		const roomRosters = []
		for (const room of rooms) {
			const nodeHashes = []
			for (const { remoteNodeHash } of room.getRoster()) {
				if (!remoteNodeHash) continue
				if (isNodeBlocked(remoteNodeHash)) blocked.add(remoteNodeHash)
				else if (isQuarantinedPure(rep, remoteNodeHash)) quarantined.add(remoteNodeHash)
				else nodeHashes.push(remoteNodeHash)
			}
			/**
			 * @param {string} remoteNodeHash 64 hex
			 * @returns {number} 本地主观信誉分；从未打分的新人退回 rosterDefaultScore
			 */
			function rosterScoreOf(remoteNodeHash) {
				const row = rep.byNodeHash?.[remoteNodeHash]
				return row && Number.isFinite(Number(row.score))
					? Number(row.score)
					: trustGraphTunables.rosterDefaultScore
			}
			roomRosters.push({
				scopeId: room.groupId,
				nodeHashes,
				scoreOf: rosterScoreOf,
			})
		}

		return mergeGraph({
			trustedPeers: net.trustedPeers,
			explorePeers: net.explorePeers,
			hints: net.hints,
			roomRosters,
			blockedNodeHashes: blocked,
			quarantinedNodeHashes: quarantined,
			scoreOf,
		})
	})
}

/**
 * @param {string} username replica 登录名
 * @param {string} targetNodeHash 64 hex
 * @param {string} actionName Trystero action
 * @param {unknown} payload 载荷
 * @returns {Promise<boolean>} 是否已发送
 */
export async function sendToNode(username, targetNodeHash, actionName, payload) {
	const target = normalizeHex64(targetNodeHash) || String(targetNodeHash || '').trim().toLowerCase()
	if (!isHex64(target)) return false
	await ensureUserRoom({ replicaUsername: username })
	const targetNode = (await buildMergedGraph(username)).get(target)
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
 * @param {number} [limit=12] 最多返回节点数
 * @returns {Promise<TrustNode[]>} 按信誉降序
 */
export async function pickTopNodes(username, limit = trustGraphTunables.pickTopNodesDefaultLimit) {
	await ensureUserRoom({ replicaUsername: username })
	const rep = loadReputation()
	const quarantined = new Set(
		Object.keys(rep.byNodeHash || {}).filter(id => isQuarantinedPure(rep, id)),
	)
	return pickTopFromGraph(await buildMergedGraph(username), limit, trustGraphTunables, quarantined)
}

/**
 * @param {string} username replica 登录名
 * @param {string} actionName action 名
 * @param {unknown} payload 载荷
 * @param {number} [limit] K（省略时按 roster 规模缩放）
 * @returns {Promise<number>} 发送次数
 */
export async function fanoutToTopNodes(username, actionName, payload, limit) {
	const graph = await buildMergedGraph(username)
	const k = limit ?? resolveFederationFanoutTopK(graph.size, trustGraphTunables)
	let sent = 0
	for (const { nodeHash } of await pickTopNodes(username, k))
		if (await sendToNode(username, nodeHash, actionName, payload)) sent++
	return sent
}

/**
 * @returns {import('./trust_graph_registry.mjs').TrustGraphProvider} 默认 trust graph 实现
 */
export function createDefaultTrustGraphProvider() {
	return {
		buildMergedGraph,
		pickTopNodes,
		sendToNode,
		fanoutToTopNodes,
	}
}

