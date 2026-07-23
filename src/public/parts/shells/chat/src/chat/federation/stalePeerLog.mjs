/**
 * 联邦房间陈旧 peer 自愈修剪可观测性：进程内计数器 + 近期记录。
 */

/** @type {Map<string, number>} scopeId → 累计修剪次数 */
const pruneCounts = new Map()
/** @type {Array<{ ts: number, scope: string, peerId: string, nodeHash: string | null, meta?: object }>} */
const recent = []
const RECENT_CAP = 200

/**
 * 记录一批陈旧 peer 修剪。
 * @param {string} scope 计数器 scope（群 id / 房间标签）
 * @param {Array<{ peerId: string, remoteNodeHash?: string }>} staleEntries 被修剪条目
 * @param {object} [meta] 写入磁盘记录的额外上下文（partitionId / room）
 * @returns {void}
 */
export function recordStalePeerPrune(scope, staleEntries, meta = {}) {
	if (!staleEntries?.length) return
	pruneCounts.set(scope, (pruneCounts.get(scope) || 0) + staleEntries.length)
	const ts = Date.now()
	const lines = []
	for (const { peerId, remoteNodeHash } of staleEntries) {
		const record = { ts, scope, peerId, nodeHash: remoteNodeHash || null, ...meta }
		recent.push(record)
		lines.push(JSON.stringify(record))
	}
	while (recent.length > RECENT_CAP) recent.shift()
}

/**
 * @param {string} scope 计数器 scope
 * @returns {number} 该 scope 累计修剪次数
 */
export function getStalePeerPruneCount(scope) {
	return pruneCounts.get(scope) || 0
}

/**
 * @returns {Array<{ ts: number, scope: string, peerId: string, nodeHash: string | null, meta?: object }>} 近期修剪记录
 */
export function getRecentStalePeerPrunes() {
	return [...recent]
}
