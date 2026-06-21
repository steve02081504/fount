/**
 * TrustGraph 纯图合并/选择（模拟器与 trust_graph.mjs 共用）。
 */
import trustGraphTunables from './trust_graph.tunables.json' with { type: 'json' }
import { resolveFederationFanoutTopK } from './tunables_resolve.mjs'

/**
 * @typedef {{ nodeHash: string, score: number, scopeIds: string[] }} TrustNode
 * @typedef {{
 *   trustedPeers?: string[],
 *   explorePeers?: string[],
 *   hints?: Array<{ nodeHash: string, source?: string, weight?: number, expiresAt?: number }>,
 *   roomRosters?: Array<{ scopeId: string, nodeHashes: string[], scoreOf?: (nodeHash: string) => number }>,
 *   blockedNodeHashes?: Set<string>,
 *   quarantinedNodeHashes?: Set<string>,
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
	/**
	 * @typedef {{
	 *   scopeIds: Set<string>,
	 *   networkScores: number[],
	 *   rosterScores: number[],
	 *   hintWeightSum: number,
	 *   hintSources: Set<string>,
	 * }} NodeEvidence
	 */
	/** @type {Map<string, NodeEvidence>} */
	const evidenceByNode = new Map()
	const blocked = inputs.blockedNodeHashes || new Set()
	const quarantined = inputs.quarantinedNodeHashes || new Set()
	const damp = Number(tunables.quarantineTrustDamp ?? 0.35)
	const now = inputs.now ?? Date.now()
	/**
	 * @param {string} nodeHash 64 hex
	 * @returns {boolean} 是否拉黑
	 */
	function isBlocked(nodeHash) {
		return blocked.has(nodeHash)
	}

	/**
	 * @param {string} nodeHash 64 hex
	 * @returns {boolean} 是否本地隔离
	 */
	function isQuarantined(nodeHash) {
		return quarantined.has(nodeHash)
	}

	/**
	 * @param {string} nodeHash 64 hex
	 * @returns {NodeEvidence} 节点证据容器
	 */
	function nodeEvidence(nodeHash) {
		let ev = evidenceByNode.get(nodeHash)
		if (!ev) {
			ev = {
				scopeIds: new Set(),
				networkScores: [],
				rosterScores: [],
				hintWeightSum: 0,
				hintSources: new Set(),
			}
			evidenceByNode.set(nodeHash, ev)
		}
		return ev
	}

	for (const nodeHash of [...inputs.trustedPeers || [], ...inputs.explorePeers || []]) {
		if (isBlocked(nodeHash)) continue
		const score = inputs.scoreOf?.(nodeHash) ?? 0
		const ev = nodeEvidence(nodeHash)
		ev.scopeIds.add('network')
		ev.networkScores.push(Number(score))
	}

	for (const hint of inputs.hints || []) {
		if (hint.expiresAt && hint.expiresAt <= now) continue
		if (isBlocked(hint.nodeHash)) continue
		const ev = nodeEvidence(hint.nodeHash)
		ev.scopeIds.add(`hint:${hint.source ?? 'unknown'}`)
		const rawWeight = Number(hint.weight ?? tunables.hintDefaultWeight)
		if (Number.isFinite(rawWeight) && rawWeight > 0)
			ev.hintWeightSum += rawWeight
		ev.hintSources.add(String(hint.source ?? 'unknown'))
	}

	for (const room of inputs.roomRosters || [])
		for (const remoteNodeHash of room.nodeHashes) {
			if (!remoteNodeHash || isBlocked(remoteNodeHash)) continue
			// 名册只能告诉你「这个节点存在于该 scope」；信任分一律取本地主观信誉，
			// 仅当本地从未给它打过分（新人）时才退回 rosterDefaultScore。
			const local = room.scoreOf?.(remoteNodeHash) ?? inputs.scoreOf?.(remoteNodeHash)
			const score = Number.isFinite(Number(local)) ? Number(local) : tunables.rosterDefaultScore
			const ev = nodeEvidence(remoteNodeHash)
			ev.scopeIds.add(room.scopeId)
			ev.rosterScores.push(score)
		}

	/** @type {Map<string, TrustNode>} */
	const byNode = new Map()
	for (const [nodeHash, ev] of evidenceByNode.entries()) {
		const networkMean = ev.networkScores.length
			? ev.networkScores.reduce((s, n) => s + n, 0) / ev.networkScores.length
			: NaN
		const rosterMean = ev.rosterScores.length
			? ev.rosterScores.reduce((s, n) => s + n, 0) / ev.rosterScores.length
			: NaN
		const baseScores = [networkMean, rosterMean].filter(Number.isFinite)
		const baseScore = baseScores.length
			? baseScores.reduce((s, n) => s + n, 0) / baseScores.length
			: 0

		// Hint 只做“发现增益”：收益按总权重指数饱和，防止多源投毒线性抬分。
		const hintScale = 0.1
		const saturatedHintLift = tunables.hintMaxBonus * (1 - Math.exp(-ev.hintWeightSum / hintScale))
		const hasHardEvidence = ev.networkScores.length + ev.rosterScores.length > 0
		const hintReliability = hasHardEvidence ? 1 : 0.35
		let score = baseScore + saturatedHintLift * hintReliability
		if (isQuarantined(nodeHash))
			score *= damp

		byNode.set(nodeHash, { nodeHash, score, scopeIds: [...ev.scopeIds] })
	}
	return byNode
}

/**
 * @param {Map<string, TrustNode>} graph 合并图
 * @param {number} [limit] 最多返回节点数
 * @param {typeof trustGraphTunables} [tunables] tunables
 * @param {Set<string>} [quarantinedNodeHashes] 本地隔离节点（踢出 topK）
 * @returns {TrustNode[]} 按信誉降序
 */
export function pickTopFromGraph(graph, limit = trustGraphTunables.pickTopNodesDefaultLimit, tunables = trustGraphTunables, quarantinedNodeHashes = new Set()) {
	const k = limit ?? tunables.pickTopNodesDefaultLimit
	return [...graph.values()]
		.filter(node => !quarantinedNodeHashes.has(node.nodeHash))
		.sort((a, b) => b.score - a.score)
		.slice(0, Math.max(1, k))
}

/**
 * @param {TrustGraphInputs} inputs 图输入
 * @param {number} [limit] fanout K
 * @param {typeof trustGraphTunables} [tunables] tunables
 * @returns {TrustNode[]} Top-K 节点
 */
export function pickTop(inputs, limit, tunables = trustGraphTunables) {
	const graph = mergeGraph(inputs, tunables)
	const k = limit ?? resolveFederationFanoutTopK(graph.size, tunables)
	return pickTopFromGraph(graph, k, tunables, inputs.quarantinedNodeHashes || new Set())
}
