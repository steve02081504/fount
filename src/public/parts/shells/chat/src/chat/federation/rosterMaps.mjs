/**
 * 按在线 peer 集合将 roster 分为 live 与 stale。
 * @param {Array<{ peerId: string, remoteNodeHash?: string }>} rosterEntries roster 条目
 * @param {Iterable<string>} livePeerIds 当前在线 peer id 集合
 * @returns {{ live: Array<{ peerId: string, remoteNodeHash?: string }>, stale: Array<{ peerId: string, remoteNodeHash?: string }> }} 分组结果
 */
export function partitionRosterByLiveness(rosterEntries, livePeerIds) {
	const liveSet = livePeerIds instanceof Set ? livePeerIds : new Set(livePeerIds)
	/** @type {Array<{ peerId: string, remoteNodeHash?: string }>} */
	const live = []
	/** @type {Array<{ peerId: string, remoteNodeHash?: string }>} */
	const stale = []
	for (const entry of rosterEntries) {
		if (!entry?.peerId) continue
		const bucket = liveSet.has(entry.peerId) ? live : stale
		bucket.push(entry)
	}
	return { live, stale }
}

/**
 * 从 peer↔node 映射中移除离线条目。
 * @param {Map<string, string>} peerToNode 对端 id → nodeHash
 * @param {Map<string, string>} nodeToPeer nodeHash → 对端 id
 * @param {Iterable<string>} livePeerIds 当前在线 peer id 集合
 * @returns {Array<{ peerId: string, remoteNodeHash?: string }>} 被移除的 stale 条目
 */
export function pruneStaleRosterEntries(peerToNode, nodeToPeer, livePeerIds) {
	const entries = [...peerToNode.entries()].map(([peerId, remoteNodeHash]) => ({ peerId, remoteNodeHash }))
	const { stale } = partitionRosterByLiveness(entries, livePeerIds)
	for (const { peerId, remoteNodeHash } of stale) {
		peerToNode.delete(peerId)
		if (remoteNodeHash && nodeToPeer.get(remoteNodeHash) === peerId) nodeToPeer.delete(remoteNodeHash)
	}
	return stale
}
