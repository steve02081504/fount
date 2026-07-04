/**
 * @param {Array<{ peerId: string, remoteNodeHash?: string }>} rosterEntries
 * @param {Iterable<string>} livePeerIds
 * @returns {{ live: Array<{ peerId: string, remoteNodeHash?: string }>, stale: Array<{ peerId: string, remoteNodeHash?: string }> }}
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
 * @param {Map<string, string>} peerToNode
 * @param {Map<string, string>} nodeToPeer
 * @param {Iterable<string>} livePeerIds
 * @returns {Array<{ peerId: string, remoteNodeHash?: string }>}
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
 * @param {object} [opts]
 * @param {() => Iterable<string>} [opts.getLivePeerIds]
 * @param {(stale: Array<{ peerId: string, remoteNodeHash?: string }>) => void} [opts.onStalePruned]
 * @returns {{ peerToNode: Map<string, string>, nodeToPeer: Map<string, string>, getRoster: () => Array<{ peerId: string, remoteNodeHash: string | undefined }>, getPeerIdByNodeHash: (nodeHash: string) => string | null, onPeerLeave: (peerId: string) => void }}
 */
export function createPeerIdentityMaps(opts = {}) {
	/** @type {Map<string, string>} */
	const peerToNode = new Map()
	/** @type {Map<string, string>} */
	const nodeToPeer = new Map()
	const getLivePeerIds = typeof opts.getLivePeerIds === 'function' ? opts.getLivePeerIds : null
	const onStalePruned = typeof opts.onStalePruned === 'function' ? opts.onStalePruned : null

	const reconcile = () => {
		if (!getLivePeerIds) return
		const stale = pruneStaleRosterEntries(peerToNode, nodeToPeer, getLivePeerIds())
		if (stale.length && onStalePruned) onStalePruned(stale)
	}

	return {
		peerToNode,
		nodeToPeer,
		getRoster() {
			reconcile()
			return [...peerToNode.entries()].map(([peerId, remoteNodeHash]) => ({ peerId, remoteNodeHash }))
		},
		getPeerIdByNodeHash(targetNodeHash) {
			reconcile()
			return nodeToPeer.get(String(targetNodeHash).trim().toLowerCase()) || null
		},
		onPeerLeave(peerId) {
			const remote = peerToNode.get(peerId)
			if (remote) nodeToPeer.delete(remote)
			peerToNode.delete(peerId)
		},
	}
}
