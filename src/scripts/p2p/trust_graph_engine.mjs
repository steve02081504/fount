/**
 * TrustGraph 纯图合并/选择（模拟器与 trust_graph.mjs 共用）。
 */
import trustGraphTunables from './trust_graph.tunables.json' with { type: 'json' }

/**
 * @typedef {{ nodeHash: string, score: number, scopeIds: string[] }} TrustNode
 * @typedef {{
 *   trustedPeers?: string[],
 *   explorePeers?: string[],
 *   hints?: Array<{ nodeHash: string, source?: string, weight?: number, expiresAt?: number }>,
 *   roomRosters?: Array<{ scopeId: string, nodeHashes: string[], scoreOf?: (nodeHash: string) => number }>,
 *   blockedNodeHashes?: Set<string>,
 *   now?: number,
 * }} TrustGraphInputs
 */

/**
 * @returns {typeof trustGraphTunables} 默认 tunables
 */
export function defaultTrustGraphTunables() {
	return trustGraphTunables
}

/**
 * @param {Map<string, TrustNode>} byNode 累积图
 * @param {string} scopeId scope 标识
 * @param {string} nodeHash 64 hex
 * @param {number} score 信誉分
 */
export function mergeTrustNode(byNode, scopeId, nodeHash, score) {
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
 * @param {TrustGraphInputs} inputs 图输入
 * @param {typeof trustGraphTunables} [tunables] tunables
 * @returns {Map<string, TrustNode>} nodeHash → 节点
 */
export function mergeGraph(inputs, tunables = trustGraphTunables) {
	/** @type {Map<string, TrustNode>} */
	const byNode = new Map()
	const blocked = inputs.blockedNodeHashes || new Set()
	const now = inputs.now ?? Date.now()
	/**
	 * @param {string} nodeHash 64 hex
	 * @returns {boolean} 是否拉黑
	 */
	function isBlocked(nodeHash) {
		return blocked.has(nodeHash)
	}

	for (const nodeHash of [...inputs.trustedPeers || [], ...inputs.explorePeers || []]) {
		if (isBlocked(nodeHash)) continue
		const score = inputs.scoreOf?.(nodeHash) ?? 0
		mergeTrustNode(byNode, 'network', nodeHash, Number(score))
	}

	for (const hint of inputs.hints || []) {
		if (hint.expiresAt && hint.expiresAt <= now) continue
		if (isBlocked(hint.nodeHash)) continue
		const base = inputs.scoreOf?.(hint.nodeHash) ?? 0
		mergeTrustNode(
			byNode,
			`hint:${hint.source}`,
			hint.nodeHash,
			Number(base) + (hint.weight ?? tunables.hintDefaultWeight),
		)
	}

	for (const room of inputs.roomRosters || []) 
		for (const remoteNodeHash of room.nodeHashes) {
			if (!remoteNodeHash || isBlocked(remoteNodeHash)) continue
			const score = room.scoreOf?.(remoteNodeHash) ?? inputs.scoreOf?.(remoteNodeHash) ?? tunables.rosterDefaultScore
			mergeTrustNode(byNode, room.scopeId, remoteNodeHash, Number(score) || tunables.rosterDefaultScore)
		}
	

	return byNode
}

/**
 * @param {Map<string, TrustNode>} graph 合并图
 * @param {number} [limit] 最多返回节点数
 * @param {typeof trustGraphTunables} [tunables] tunables
 * @returns {TrustNode[]} 按信誉降序
 */
export function pickTopFromGraph(graph, limit = trustGraphTunables.pickTopNodesDefaultLimit, tunables = trustGraphTunables) {
	const k = limit ?? tunables.pickTopNodesDefaultLimit
	return [...graph.values()]
		.sort((a, b) => b.score - a.score)
		.slice(0, Math.max(1, k))
}

/**
 * @param {TrustGraphInputs} inputs 图输入
 * @param {number} [limit] fanout K
 * @param {typeof trustGraphTunables} [tunables] tunables
 * @returns {TrustNode[]} Top-K 节点
 */
export function pickTop(inputs, limit = trustGraphTunables.federationFanoutTopK, tunables = trustGraphTunables) {
	const k = limit ?? tunables.federationFanoutTopK
	return pickTopFromGraph(mergeGraph(inputs, tunables), k, tunables)
}
