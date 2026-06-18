import { isPeerKeyBlocked, isSubjectBlocked } from './blocklist.mjs'
import { FEDERATION_FANOUT_TOP_K } from './constants.mjs'
import { USER_ROOM_SCOPE } from './identity_announce.mjs'
import { loadNetwork } from './network.mjs'
import { getNodeHash } from './node_context.mjs'
import { loadReputation, pickNodeScore } from './reputation_store.mjs'
import { listFederationRoomSlots } from './room_provider_registry.mjs'
import { getCachedTrustGraph } from './trust_graph_cache.mjs'
import { registerTrustGraphProvider } from './trust_graph_registry.mjs'
import { ensureUserRoom } from './user_room.mjs'

/**
 * @typedef {{ nodeHash: string, score: number, scopeIds: string[] }} TrustNode
 */

/**
 * @param {string} nodeHash 64 hex
 * @returns {boolean} 是否拉黑
 */
function isNodeBlocked(nodeHash) {
	return isPeerKeyBlocked('', nodeHash) || isSubjectBlocked({ nodeHash })
}

/**
 * @param {Map<string, TrustNode>} byNode 累积图
 * @param {string} scopeId scope 标识
 * @param {string} nodeHash 64 hex
 * @param {number} score 信誉分
 */
function mergeTrustNode(byNode, scopeId, nodeHash, score) {
	const previous = byNode.get(nodeHash)
	if (previous) {
		const seenCount = previous.scopeIds.length
		previous.score = (previous.score * seenCount + score) / (seenCount + 1)
		if (!previous.scopeIds.includes(scopeId)) previous.scopeIds.push(scopeId)
		return
	}
	byNode.set(nodeHash, { nodeHash, score, scopeIds: [scopeId] })
}

/**
 * @param {string} username replica 登录名（联邦房间枚举仍按用户）
 * @returns {Promise<Map<string, TrustNode>>} nodeHash → 节点
 */
export async function buildMergedGraph(username) {
	return getCachedTrustGraph(async () => {
		/** @type {Map<string, TrustNode>} */
		const byNode = new Map()
		const net = loadNetwork()
		const rep = loadReputation()
		const now = Date.now()

		for (const nodeHash of [...net.trustedPeers, ...net.explorePeers]) {
			if (isNodeBlocked(nodeHash)) continue
			mergeTrustNode(byNode, 'network', nodeHash, Number(rep.byNodeHash?.[nodeHash]?.score ?? 0))
		}

		for (const hint of net.hints) {
			if (hint.expiresAt && hint.expiresAt <= now) continue
			if (isNodeBlocked(hint.nodeHash)) continue
			const base = Number(rep.byNodeHash?.[hint.nodeHash]?.score ?? 0)
			mergeTrustNode(byNode, `hint:${hint.source}`, hint.nodeHash, base + (hint.weight || 0.1))
		}

		for (const room of await listFederationRoomSlots(username)) {
			const scopeId = room.groupId
			for (const { remoteNodeHash } of room.getRoster()) {
				if (!remoteNodeHash || isNodeBlocked(remoteNodeHash)) continue
				const score = pickNodeScore(remoteNodeHash) || 0.1
				mergeTrustNode(byNode, scopeId, remoteNodeHash, score)
			}
		}

		return byNode
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
	await ensureUserRoom({ replicaUsername: username })
	const targetNode = (await buildMergedGraph(username)).get(targetNodeHash)
	if (!targetNode?.scopeIds.length) return false
	const selfNodeHash = getNodeHash()

	const rooms = await listFederationRoomSlots(username)
	const userRoom = rooms.find(room => room.groupId === USER_ROOM_SCOPE)
	const groupRooms = rooms.filter(room => room.groupId !== USER_ROOM_SCOPE)

	if (userRoom) {
		const peerId = userRoom.getPeerIdByNodeHash(targetNodeHash)
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
				for (const targetPeerId of targets.slice(0, 4))
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
export async function pickTopNodes(username, limit = 12) {
	await ensureUserRoom({ replicaUsername: username })
	return [...(await buildMergedGraph(username)).values()]
		.sort((a, b) => b.score - a.score)
		.slice(0, Math.max(1, limit))
}

/**
 * @param {string} username replica 登录名
 * @param {string} actionName action 名
 * @param {unknown} payload 载荷
 * @param {number} [limit=8] K
 * @returns {Promise<number>} 发送次数
 */
export async function fanoutToTopNodes(username, actionName, payload, limit = FEDERATION_FANOUT_TOP_K) {
	let sent = 0
	for (const { nodeHash } of await pickTopNodes(username, limit))
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

registerTrustGraphProvider('default', createDefaultTrustGraphProvider())
