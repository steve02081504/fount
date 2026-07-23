/**
 * 群联邦房间负载预算（进程内）+ 单源槽位配额与 trusted 保留。
 * chat 侧过载 shedding；链路 N/K 由 createGroupLinkSet / link_registry 负责。
 */

/** @type {Map<string, { active: Set<string>, joinTimestamps: number[], overloadUntil: number, sourceByPeer: Map<string, string>, trustedPeers: Set<string>, peerNodeHash: Map<string, string> }>} */
const budgets = new Map()

/** 单来源最多占用的非 trusted 槽位比例 */
export const MAX_SOURCE_SLOT_FRACTION = 0.25

/** 默认 trusted 保留比例 */
const DEFAULT_TRUSTED_RESERVE_FRACTION = 0.25

/** 默认 trusted 绝对保留槽位 */
const DEFAULT_MIN_TRUSTED_RESERVED = 3

/**
 * @param {object} [limits] 限额
 * @returns {{ maxActive: number, maxJoinsPerMin: number, overloadCooldownMs: number, trustedPeers?: string[], trustedReserveFraction: number, minTrustedReserved: number }} 生效限额
 */
export function resolveRtcBudgetLimits(limits = {}) {
	return {
		maxActive: Math.max(4, Math.min(128, Number(limits.maxActive) || 32)),
		maxJoinsPerMin: Math.max(1, Math.min(120, Number(limits.maxJoinsPerMin) || 12)),
		overloadCooldownMs: Math.max(1000, Number(limits.overloadCooldownMs) || 15_000),
		trustedPeers: limits.trustedPeers || [],
		trustedReserveFraction: Math.max(0.1, Math.min(0.5, Number(limits.trustedReserveFraction) || DEFAULT_TRUSTED_RESERVE_FRACTION)),
		minTrustedReserved: Math.max(1, Math.floor(Number(limits.minTrustedReserved) || DEFAULT_MIN_TRUSTED_RESERVED)),
	}
}

/**
 * @param {string} roomKey 房间键
 * @param {object} [limits] RTC 限额
 * @returns {{ active: Set<string>, joinTimestamps: number[], overloadUntil: number, sourceByPeer: Map<string, string>, trustedPeers: Set<string> }} 桶
 */
function bucketFor(roomKey, limits = {}) {
	let bucket = budgets.get(roomKey)
	if (!bucket) {
		bucket = {
			active: new Set(),
			joinTimestamps: [],
			overloadUntil: 0,
			sourceByPeer: new Map(),
			trustedPeers: new Set(resolveRtcBudgetLimits(limits).trustedPeers || []),
			peerNodeHash: new Map(),
		}
		budgets.set(roomKey, bucket)
	}
	for (const id of resolveRtcBudgetLimits(limits).trustedPeers || [])
		bucket.trustedPeers.add(String(id))
	return bucket
}

/**
 * @param {string} roomKey 房间键
 * @param {object} [limits] 限额
 * @returns {boolean} 是否处于过载冷却
 */
export function isRtcRoomOverloaded(roomKey, limits = {}) {
	const { overloadCooldownMs } = resolveRtcBudgetLimits(limits)
	const bucket = bucketFor(roomKey, limits)
	return Date.now() < bucket.overloadUntil
}

/**
 * @param {string} roomKey 房间键
 * @param {string} peerId 对等端 id
 * @param {object} [limits] 限额
 * @param {string} [sourceId='peer'] 来源标识（用于单源配额）
 * @returns {boolean} 是否允许新 join/握手
 */
export function takeRtcJoinSlot(roomKey, peerId, limits = {}, sourceId = 'peer') {
	const { maxActive, maxJoinsPerMin, overloadCooldownMs, trustedReserveFraction, minTrustedReserved } = resolveRtcBudgetLimits(limits)
	const bucket = bucketFor(roomKey, limits)
	const now = Date.now()
	if (now < bucket.overloadUntil) return false
	bucket.joinTimestamps = bucket.joinTimestamps.filter(t => now - t < 60_000)
	if (bucket.joinTimestamps.length >= maxJoinsPerMin) {
		bucket.overloadUntil = now + overloadCooldownMs
		return false
	}
	if (peerId && bucket.active.has(peerId)) return true

	const isTrusted = peerId && bucket.trustedPeers.has(peerId)
	const trustedReserved = Math.max(minTrustedReserved, Math.floor(maxActive * trustedReserveFraction))
	const maxNonTrusted = Math.max(1, maxActive - trustedReserved)
	let nonTrustedCount = 0
	for (const id of bucket.active)
		if (!bucket.trustedPeers.has(id)) nonTrustedCount++
	if (!isTrusted) {
		const source = String(sourceId || 'peer')
		let sameSource = 0
		for (const peerSource of bucket.sourceByPeer.values())
			if (peerSource === source) sameSource++
		const sourceCap = Math.max(1, Math.floor(maxActive * MAX_SOURCE_SLOT_FRACTION))
		if (sameSource >= sourceCap) return false
		if (nonTrustedCount >= maxNonTrusted && bucket.active.size >= maxActive) {
			bucket.overloadUntil = now + overloadCooldownMs
			return false
		}
	}

	if (bucket.active.size >= maxActive && !isTrusted) {
		bucket.overloadUntil = now + overloadCooldownMs
		return false
	}
	bucket.joinTimestamps.push(now)
	if (peerId) {
		bucket.active.add(peerId)
		bucket.sourceByPeer.set(peerId, String(sourceId || 'peer'))
	}
	return true
}

/**
 * @param {string} roomKey 房间键
 * @param {string} peerId 对端 id
 * @param {string} nodeHash 对等 nodeHash
 * @param {object} [limits] 限额（含 trustedPeers nodeHash 列表）
 * @returns {void}
 */
export function annotateRtcPeerNodeHash(roomKey, peerId, nodeHash, limits = {}) {
	const bucket = budgets.get(roomKey)
	if (!bucket || !peerId || !nodeHash) return
	bucket.peerNodeHash.set(peerId, String(nodeHash).trim())
	for (const trusted of resolveRtcBudgetLimits(limits).trustedPeers || [])
		if (String(trusted).trim() === String(nodeHash).trim())
			bucket.trustedPeers.add(peerId)

}

/**
 * @param {string} roomKey 房间键
 * @param {string} peerId 对端 id
 * @param {string} sourceId 来源标识（PEX hint source / explore 源）
 * @returns {void}
 */
export function setRtcPeerSource(roomKey, peerId, sourceId) {
	const bucket = budgets.get(roomKey)
	if (!bucket || !peerId) return
	bucket.sourceByPeer.set(peerId, String(sourceId || 'peer'))
}

/**
 * @param {string} roomKey 房间键
 * @param {string} peerId 对等端 id
 * @returns {void}
 */
export function releaseRtcPeer(roomKey, peerId) {
	const bucket = budgets.get(roomKey)
	if (!bucket || !peerId) return
	bucket.active.delete(peerId)
	bucket.sourceByPeer.delete(peerId)
	bucket.peerNodeHash.delete(peerId)
	// 房间空闲后丢掉桶，避免 leave 过的 roomKey 永久占内存
	if (!bucket.active.size) budgets.delete(roomKey)
}

/**
 * 当前预算桶数量（测试用）。
 * @returns {number} 房间桶数
 */
export function rtcBudgetRoomCount() {
	return budgets.size
}

/** RTC 过载时跳过的非关键联邦 action */
const NON_CRITICAL_FED_ACTIONS = new Set([
	'fed_pex',
	'fed_partition_bridge',
	'fed_chunk_put',
	'fed_chunk_get',
	'fed_chunk_data',
	'fed_chunk_ack',
	'fed_manifest_get',
	'fed_manifest_data',
	'part_invoke',
	'part_query_req',
	'part_query_res',
	'discovery_announce',
	'discovery_query',
	'char_rpc',
	'fed_volatile',
	'fed_tip_ping',
	'fed_archive_digest_obs',
])

/**
 * @param {string} roomKey 房间键
 * @param {string} actionName 联邦动作
 * @param {object} [limits] 限额
 * @returns {boolean} 是否允许处理/发送该 action
 */
export function isFederationActionAllowedUnderLoad(roomKey, actionName, limits = {}) {
	if (!isRtcRoomOverloaded(roomKey, limits)) return true
	return !NON_CRITICAL_FED_ACTIONS.has(actionName)
}
