import { isPeerKeyBlocked, isSubjectBlocked } from './denylist.mjs'
import { loadNetwork } from './network.mjs'
import { isQuarantinedPure } from './reputation_engine.mjs'
import { loadReputation } from './reputation_store.mjs'
import { listFederationRoomSlots } from './room_provider_registry.mjs'
import trustGraphTunables from './trust_graph.tunables.json' with { type: 'json' }
import { getCachedTrustGraph } from './trust_graph_cache.mjs'
import { mergeGraph, pickTopFromGraph } from './trust_graph_engine.mjs'
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
	return getCachedTrustGraph(username, async () => {
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
