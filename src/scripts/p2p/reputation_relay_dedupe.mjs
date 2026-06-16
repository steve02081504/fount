/**
 * 联邦中继信誉加分去重（纯函数）。
 */
export const RELAY_BUMP_DEDUPE_MS = 24 * 3600 * 1000

/**
 * @param {Array<{ peerNodeHash: string, key: string, t: number }>} relayBumpSeen 已记录贡献
 * @param {string} peerNodeHash 对端节点
 * @param {string} dedupeKey 去重键
 * @param {number} [now] 当前时间
 * @returns {boolean} 24h 内已计过分则为 true
 */
export function relayBumpIsDuplicate(relayBumpSeen, peerNodeHash, dedupeKey, now = Date.now()) {
	if (!peerNodeHash) return true
	const dedupe = dedupeKey || `conn:${peerNodeHash}`
	return relayBumpSeen.some(
		entry => entry.peerNodeHash === peerNodeHash
			&& entry.key === dedupe
			&& now - entry.t <= RELAY_BUMP_DEDUPE_MS,
	)
}
