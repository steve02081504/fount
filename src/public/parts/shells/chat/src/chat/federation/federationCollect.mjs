/**
 * 联邦多 peer 应答收集：超时、全量收齐、quorum 提前结束。
 */
import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'

/**
 * @param {Array<{ complete?: boolean, digest?: string, verified?: boolean }>} candidates 月拉候选
 * @param {number} [peerMin=2] 同 digest 所需 peer 数（由 resolveArchiveQuorumPeerMin 缩放）
 * @returns {boolean} 是否已有 digest quorum
 */
export function archiveMonthQuorumSatisfied(candidates, peerMin = 2) {
	/** @type {Map<string, number>} */
	const byDigest = new Map()
	for (const row of candidates) {
		if (!row.complete || row.verified !== true) continue
		const digest = String(row.digest || '').trim().toLowerCase()
		if (!isHex64(digest)) continue
		byDigest.set(digest, (byDigest.get(digest) || 0) + 1)
	}
	const min = Math.max(1, Math.floor(Number(peerMin) || 2))
	for (const count of byDigest.values())
		if (count >= min) return true
	return false
}

/**
 * @param {Array<{ bucketKey?: string }>} candidates 入群快照候选
 * @param {number} [peerMin=2] 同 bucket 所需 peer 数
 * @returns {boolean} 是否已有 checkpoint 分桶 quorum
 */
export function joinSnapshotQuorumSatisfied(candidates, peerMin = 2) {
	/** @type {Map<string, number>} */
	const byBucket = new Map()
	for (const row of candidates) {
		const key = String(row.bucketKey || '').trim()
		if (!key) continue
		byBucket.set(key, (byBucket.get(key) || 0) + 1)
	}
	const min = Math.max(1, Math.floor(Number(peerMin) || 2))
	for (const count of byBucket.values())
		if (count >= min) return true
	return false
}

/**
 * @param {number} waitMs 超时毫秒
 * @param {number} expectedCount 目标 peer 数（0 表示仅超时结束）
 * @param {() => void} [onSettled] 结束回调（如从 Map 删除等待键）
 * @returns {{ finish: (list: object[]) => void, promise: Promise<object[]>, pending: { candidates: object[], expectedCount: number, quorumPeerMin?: number, finish: (list: object[]) => void } }} 收集句柄
 */
export function createFederationCollect(waitMs, expectedCount, onSettled) {
	/** @type {boolean} */
	let settled = false
	/** @type {object[]} */
	const candidates = []
	/** @type {ReturnType<typeof setTimeout>} */
	let timer

	/**
	 * @param {object[]} list 候选列表
	 * @returns {void}
	 */
	const finish = list => {
		if (settled) return
		settled = true
		clearTimeout(timer)
		onSettled?.()
		resolve(list)
	}

	/** @type {(v: object[]) => void} */
	let resolve
	const promise = new Promise(res => { resolve = res })

	timer = setTimeout(() => finish(candidates), waitMs)

	const pending = {
		candidates,
		expectedCount,
		quorumPeerMin: 2,
		finish,
	}

	return { finish, promise, pending }
}

/**
 * @param {{ candidates: object[], expectedCount: number, quorumPeerMin?: number, finish: (list: object[]) => void }} pending 等待桶
 * @param {(list: object[], peerMin?: number) => boolean} quorumSatisfied 仲裁谓词
 * @returns {void}
 */
export function tryFinishFederationCollect(pending, quorumSatisfied) {
	if (pending.expectedCount > 0 && pending.candidates.length >= pending.expectedCount) {
		pending.finish(pending.candidates)
		return
	}
	if (quorumSatisfied(pending.candidates, pending.quorumPeerMin))
		pending.finish(pending.candidates)
}
