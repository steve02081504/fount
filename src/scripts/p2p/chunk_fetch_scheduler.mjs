/**
 * 联邦分块拉取调度：按 peer 轮转分配缺失块，支持超时重试与广播兜底。
 */

/** @typedef {'pending' | 'inflight' | 'done' | 'failed'} ChunkFetchState */

/**
 * @param {string[]} chunkHashes 缺失块哈希（有序）
 * @param {string[]} peerIds 可用 peerId 列表
 * @returns {Map<string, string>} chunkHash → 首选 peerId
 */
export function assignChunksToPeers(chunkHashes, peerIds) {
	/** @type {Map<string, string>} */
	const out = new Map()
	if (!peerIds.length) return out
	const list = peerIds.filter(Boolean)
	for (let i = 0; i < chunkHashes.length; i++)
		out.set(chunkHashes[i], list[i % list.length])
	return out
}

/**
 * @param {Map<string, { state: ChunkFetchState, peerId?: string, attempts: number }>} table 状态表
 * @param {string[]} chunkHashes 待拉取块
 * @param {string[]} peerIds 可用 peer
 * @param {{ maxAttempts?: number }} [opts] 选项
 * @returns {{ assignments: Map<string, string>, broadcast: string[] }} 分配与需广播块
 */
export function planChunkFetches(table, chunkHashes, peerIds, opts = {}) {
	const maxAttempts = Math.max(1, Number(opts.maxAttempts) || 3)
	const assignments = assignChunksToPeers(chunkHashes, peerIds)
	/** @type {string[]} */
	const broadcast = []
	for (const hash of chunkHashes) {
		const row = table.get(hash) || { state: 'pending', attempts: 0 }
		if (row.state === 'done') continue
		if (row.state === 'inflight') continue
		if (row.attempts >= maxAttempts) {
			broadcast.push(hash)
			continue
		}
		const peerId = assignments.get(hash)
		if (!peerId) broadcast.push(hash)
	}
	return { assignments, broadcast }
}

/**
 * @param {Map<string, { state: ChunkFetchState, peerId?: string, attempts: number }>} table 状态表
 * @param {string} chunkHash 块哈希
 * @param {string} peerId 目标 peer
 * @returns {void}
 */
export function markChunkInflight(table, chunkHash, peerId) {
	const prev = table.get(chunkHash) || { state: 'pending', attempts: 0 }
	table.set(chunkHash, {
		state: 'inflight',
		peerId,
		attempts: prev.attempts + 1,
	})
}

/**
 * @param {Map<string, { state: ChunkFetchState, peerId?: string, attempts: number }>} table 状态表
 * @param {string} chunkHash 块哈希
 * @returns {void}
 */
export function markChunkDone(table, chunkHash) {
	table.set(chunkHash, { state: 'done', attempts: 0 })
}

/**
 * @param {Map<string, { state: ChunkFetchState, peerId?: string, attempts: number }>} table 状态表
 * @param {string} chunkHash 块哈希
 * @returns {void}
 */
export function markChunkFailed(table, chunkHash) {
	const prev = table.get(chunkHash) || { state: 'pending', attempts: 0 }
	table.set(chunkHash, { state: 'failed', attempts: prev.attempts })
}

/**
 * @param {Map<string, { state: ChunkFetchState, peerId?: string, attempts: number }>} table 状态表
 * @returns {{ done: number, pending: number, inflight: number, failed: number, total: number }} 进度
 */
export function chunkFetchProgress(table) {
	let done = 0
	let pending = 0
	let inflight = 0
	let failed = 0
	for (const row of table.values())
		if (row.state === 'done') done++
		else if (row.state === 'inflight') inflight++
		else if (row.state === 'failed') failed++
		else pending++
	return { done, pending, inflight, failed, total: table.size }
}
