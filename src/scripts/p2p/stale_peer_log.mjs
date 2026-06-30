/**
 * 联邦/房间「失效 peer 自愈剔除」观测：进程内计数 + 最近记录 + debug_logs 落盘。
 *
 * 设计取向：不做兜底，只把「身份映射滞后于真实连接」这一异常**实时记录到发生地点**（群/房间 + peerId + nodeHash），
 * 便于回溯 onPeerLeave 为何漏触发。计数可经 catchup stats 暴露给测试，落盘记录可在 debug_logs/ 直接 grep。
 */
import { debugLog } from '../debug_log.mjs'

/** @type {Map<string, number>} scopeId → 累计剔除条目数 */
const pruneCounts = new Map()
/** @type {Array<{ ts: number, scope: string, peerId: string, nodeHash: string | null, meta?: object }>} */
const recent = []
const RECENT_CAP = 200

/**
 * 记录一次失效 peer 剔除。
 * @param {string} scope 计数作用域（群 id / 房间标签）
 * @param {Array<{ peerId: string, remoteNodeHash?: string }>} staleEntries 被剔除的条目
 * @param {object} [meta] 附加上下文（如 partitionId / room），写入落盘记录
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
	void debugLog('federation_stale_peer', `${lines.join('\n')}\n`).catch(() => { /* 观测尽力而为，不阻断主流程 */ })
}

/**
 * @param {string} scope 计数作用域
 * @returns {number} 该作用域累计剔除条目数
 */
export function getStalePeerPruneCount(scope) {
	return pruneCounts.get(scope) || 0
}

/**
 * @returns {Array<{ ts: number, scope: string, peerId: string, nodeHash: string | null, meta?: object }>} 最近的失效剔除记录
 */
export function getRecentStalePeerPrunes() {
	return [...recent]
}
