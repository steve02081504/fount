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
 * @param {Map<string, string>} peerToNode peer id → nodeHash
 * @param {Map<string, string>} nodeToPeer nodeHash → peer id
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

/**
 * 创建 peer id 与 nodeHash 双向映射及 roster 查询辅助。
 * @param {object} [opts] 选项
 * @param {() => Iterable<string>} [opts.getLivePeerIds] 获取当前在线 peer id 的回调
 * @param {(stale: Array<{ peerId: string, remoteNodeHash?: string }>) => void} [opts.onStalePruned] stale 条目被清理时的回调
 * @returns {{ peerToNode: Map<string, string>, nodeToPeer: Map<string, string>, getRoster: () => Array<{ peerId: string, remoteNodeHash: string | undefined }>, getPeerIdByNodeHash: (nodeHash: string) => string | null, onPeerLeave: (peerId: string) => void }} 映射与查询接口
 */
export function createPeerIdentityMaps(opts = {}) {
	/** @type {Map<string, string>} */
	const peerToNode = new Map()
	/** @type {Map<string, string>} */
	const nodeToPeer = new Map()
	const getLivePeerIds = typeof opts.getLivePeerIds === 'function' ? opts.getLivePeerIds : null
	const onStalePruned = typeof opts.onStalePruned === 'function' ? opts.onStalePruned : null

	/**
	 * 根据 live peer 集合清理 stale 映射。
	 * @returns {void}
	 */
	const reconcile = () => {
		if (!getLivePeerIds) return
		const stale = pruneStaleRosterEntries(peerToNode, nodeToPeer, getLivePeerIds())
		if (stale.length && onStalePruned) onStalePruned(stale)
	}

	return {
		peerToNode,
		nodeToPeer,
		/**
		 * 返回当前 roster（会先 reconcile stale 条目）。
		 * @returns {Array<{ peerId: string, remoteNodeHash: string | undefined }>} roster 列表
		 */
		getRoster() {
			reconcile()
			return [...peerToNode.entries()].map(([peerId, remoteNodeHash]) => ({ peerId, remoteNodeHash }))
		},
		/**
		 * 按 nodeHash 查找对应 peer id。
		 * @param {string} targetNodeHash 目标节点 64 hex
		 * @returns {string | null} peer id；无映射时 null
		 */
		getPeerIdByNodeHash(targetNodeHash) {
			reconcile()
			return nodeToPeer.get(String(targetNodeHash).trim().toLowerCase()) || null
		},
		/**
		 * peer 离线时从映射中移除。
		 * @param {string} peerId 离线的 peer id
		 * @returns {void}
		 */
		onPeerLeave(peerId) {
			const remote = peerToNode.get(peerId)
			if (remote) nodeToPeer.delete(remote)
			peerToNode.delete(peerId)
		},
	}
}
