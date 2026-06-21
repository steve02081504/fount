/**
 * 共享 tunables 缩放：ratio + floor + cap，仿真与运行时共用。
 */

/** @typedef {{ floor: number, ratio: number, cap?: number }} ScaleSpec */

/**
 * @param {number} n 分母（在场人数 / 候选 peer 数等）
 * @param {ScaleSpec} spec floor、ratio、可选 cap
 * @returns {number} 有效整数阈值 ≥ floor
 */
export function scaleCount(n, { floor, ratio, cap = Infinity }) {
	const safeN = Math.max(0, Math.floor(Number(n) || 0))
	const scaled = Math.ceil(safeN * Number(ratio) || 0)
	const capped = Number.isFinite(cap) ? Math.min(scaled, Math.floor(cap)) : scaled
	const bounded = safeN > 0 ? Math.min(capped, safeN) : Math.max(1, Math.floor(floor))
	return Math.max(Math.max(1, Math.floor(floor)), bounded)
}

/**
 * @param {number} n 群 activeMembers 或联邦应答 peer 数
 * @param {object} tunables archive tunables
 * @returns {number} 收集阶段 quorum peerMin
 */
export function resolveArchiveQuorumPeerMin(n, tunables) {
	return scaleCount(n, {
		floor: tunables.archiveQuorumPeerMinFloor ?? tunables.archiveQuorumPeerMin ?? 2,
		ratio: tunables.archiveQuorumPeerMinRatio ?? 0.25,
	})
}

/**
 * @param {number} n 群 activeMembers 或联邦应答 peer 数
 * @param {object} tunables archive tunables
 * @returns {number} 无正信誉时 strictMin（硬钳 ≥2）
 */
export function resolveArchiveQuorumPeerStrictMin(n, tunables) {
	const raw = scaleCount(n, {
		floor: tunables.archiveQuorumPeerStrictMinFloor ?? tunables.archiveQuorumPeerStrictMin ?? 2,
		ratio: tunables.archiveQuorumPeerStrictMinRatio ?? 0.5,
	})
	return Math.max(2, raw)
}

/**
 * @param {number} peerCount 已知在线 relay 候选数
 * @param {object} tunables mailbox tunables
 * @returns {number} trusted tier relay fanout
 */
export function resolveMailboxRelayFanout(peerCount, tunables) {
	if (Number.isFinite(tunables.relayFanoutTrusted))
		return Math.max(1, Math.min(peerCount > 0 ? peerCount : Infinity, Math.floor(tunables.relayFanoutTrusted)))
	return scaleCount(peerCount, {
		floor: tunables.relayFanoutTrustedFloor ?? 3,
		ratio: tunables.relayFanoutTrustedRatio ?? 0.3,
		cap: tunables.relayFanoutTrustedCap ?? 32,
	})
}

/**
 * @param {number} peerCount 已知在线 relay 候选数
 * @param {object} tunables mailbox tunables
 * @returns {number} want 广播 fanout
 */
export function resolveMailboxWantFanout(peerCount, tunables) {
	if (Number.isFinite(tunables.wantFanout))
		return Math.max(1, Math.min(peerCount > 0 ? peerCount : Infinity, Math.floor(tunables.wantFanout)))
	return scaleCount(peerCount, {
		floor: tunables.wantFanoutFloor ?? 3,
		ratio: tunables.wantFanoutRatio ?? 0.4,
		cap: tunables.wantFanoutCap ?? 32,
	})
}

/**
 * @param {number} rosterSize trust graph roster 大小
 * @param {object} tunables trust_graph tunables
 * @returns {number} federation fanout Top-K
 */
export function resolveFederationFanoutTopK(rosterSize, tunables) {
	if (Number.isFinite(tunables.federationFanoutTopK))
		return Math.max(1, Math.min(rosterSize > 0 ? rosterSize : Infinity, Math.floor(tunables.federationFanoutTopK)))
	return scaleCount(rosterSize, {
		floor: tunables.federationFanoutTopKFloor ?? 3,
		ratio: tunables.federationFanoutTopKRatio ?? 0.35,
		cap: tunables.federationFanoutTopKCap ?? 16,
	})
}

/**
 * @param {object} tunables archive tunables
 * @param {number} [activeMemberCount] 群 active 成员数
 * @param {number} [candidatePeerCount] 联邦候选 peer 数
 * @returns {{ peerMin: number, strictMin: number }} 归档 quorum 阈值
 */
export function resolveArchiveQuorumThresholds(tunables, activeMemberCount, candidatePeerCount) {
	const n = Math.max(
		Number(activeMemberCount) || 0,
		Number(candidatePeerCount) || 0,
	)
	return {
		peerMin: resolveArchiveQuorumPeerMin(n, tunables),
		strictMin: resolveArchiveQuorumPeerStrictMin(n, tunables),
	}
}
