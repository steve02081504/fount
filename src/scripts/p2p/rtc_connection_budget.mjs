/**
 * Trystero/WebRTC 连接预算（进程内）+ 单源槽位配额与 trusted 保留。
 */

/** @type {Map<string, { active: Set<string>, joinTimestamps: number[], overloadUntil: number, sourceByPeer: Map<string, string>, trustedPeers: Set<string>, peerNodeHash: Map<string, string> }>} */
const budgets = new Map()

/** 单来源最多占用的非 trusted 槽位比例 */
const MAX_SOURCE_SLOT_FRACTION = 0.35

/**
 * @param {object} [limits] 限额
 * @returns {{ maxActive: number, maxJoinsPerMin: number, overloadCooldownMs: number, trustedPeers?: string[] }} 生效限额
 */
export function resolveRtcBudgetLimits(limits = {}) {
	return {
		maxActive: Math.max(4, Math.min(128, Number(limits.maxActive) || 32)),
		maxJoinsPerMin: Math.max(1, Math.min(120, Number(limits.maxJoinsPerMin) || 12)),
		overloadCooldownMs: Math.max(1000, Number(limits.overloadCooldownMs) || 15_000),
		trustedPeers: Array.isArray(limits.trustedPeers) ? limits.trustedPeers.map(String) : [],
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
	const { maxActive, maxJoinsPerMin, overloadCooldownMs } = resolveRtcBudgetLimits(limits)
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
	const maxNonTrusted = Math.max(1, Math.floor(maxActive * (1 - 0.15)))
	const nonTrustedCount = [...bucket.active].filter(id => !bucket.trustedPeers.has(id)).length
	if (!isTrusted) {
		const source = String(sourceId || 'peer')
		const sameSource = [...bucket.sourceByPeer.entries()].filter(([, s]) => s === source).length
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
 * @param {string} peerId Trystero peer id
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
 * @param {string} peerId Trystero peer id
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
}

/** RTC 过载时跳过的非关键联邦 action */
const NON_CRITICAL_FED_ACTIONS = new Set([
	'fed_pex',
	'fed_partition_bridge',
	'fed_chunk_put',
	'fed_chunk_get',
	'fed_chunk_data',
	'fed_chunk_ack',
	'part_invoke',
	'discovery_announce',
	'discovery_query',
	'char_rpc',
	'fed_volatile',
	'fed_tip_ping',
	'fed_archive_digest_obs',
])

/**
 * @param {string} roomKey 房间键
 * @param {string} actionName Trystero action
 * @param {object} [limits] 限额
 * @returns {boolean} 是否允许处理/发送该 action
 */
export function isFederationActionAllowedUnderLoad(roomKey, actionName, limits = {}) {
	if (!isRtcRoomOverloaded(roomKey, limits)) return true
	return !NON_CRITICAL_FED_ACTIONS.has(String(actionName || '').trim())
}
