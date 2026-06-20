/**
 * 按信誉分排序后的一次性邻接构建（避免每节点重复 sort）。
 */

/**
 * @param {string[]} ids 参与构图的节点 id
 * @param {(id: string) => number} scoreOf 信誉分
 * @param {number} maxPeers 每节点最多邻居数
 * @returns {Map<string, string[]>} id → 邻居 id 列表（按 scoreOf 降序取前 maxPeers）
 */
export function buildRankedNeighborAdj(ids, scoreOf, maxPeers) {
	const sorted = [...ids].sort((a, b) => scoreOf(b) - scoreOf(a))
	/** @type {Map<string, string[]>} */
	const adj = new Map()
	for (const id of ids) {
		/** @type {string[]} */
		const peers = []
		for (const peer of sorted) {
			if (peer === id) continue
			peers.push(peer)
			if (peers.length >= maxPeers) break
		}
		adj.set(id, peers)
	}
	return adj
}
