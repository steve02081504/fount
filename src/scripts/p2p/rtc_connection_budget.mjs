/**
 * Trystero/WebRTC 连接预算（进程内）。
 */

/** @type {Map<string, { active: Set<string>, joinTimestamps: number[], overloadUntil: number }>} */
const budgets = new Map()

/**
 * @param {object} [limits] 限额
 * @returns {{ maxActive: number, maxJoinsPerMin: number, overloadCooldownMs: number }} 生效限额
 */
export function resolveRtcBudgetLimits(limits = {}) {
	return {
		maxActive: Math.max(4, Math.min(128, Number(limits.maxActive) || 32)),
		maxJoinsPerMin: Math.max(1, Math.min(120, Number(limits.maxJoinsPerMin) || 12)),
		overloadCooldownMs: Math.max(1000, Number(limits.overloadCooldownMs) || 15_000),
	}
}

/**
 * @param {string} roomKey 房间键
 * @returns {{ active: Set<string>, joinTimestamps: number[], overloadUntil: number }} 桶
 */
function bucketFor(roomKey) {
	let bucket = budgets.get(roomKey)
	if (!bucket) {
		bucket = { active: new Set(), joinTimestamps: [], overloadUntil: 0 }
		budgets.set(roomKey, bucket)
	}
	return bucket
}

/**
 * @param {string} roomKey 房间键
 * @param {object} [limits] 限额
 * @returns {boolean} 是否处于过载冷却
 */
export function isRtcRoomOverloaded(roomKey, limits = {}) {
	const { overloadCooldownMs } = resolveRtcBudgetLimits(limits)
	const bucket = bucketFor(roomKey)
	return Date.now() < bucket.overloadUntil
}

/**
 * @param {string} roomKey 房间键
 * @param {string} peerId 对等端 id
 * @param {object} [limits] 限额
 * @returns {boolean} 是否允许新 join/握手
 */
export function takeRtcJoinSlot(roomKey, peerId, limits = {}) {
	const { maxActive, maxJoinsPerMin, overloadCooldownMs } = resolveRtcBudgetLimits(limits)
	const bucket = bucketFor(roomKey)
	const now = Date.now()
	if (now < bucket.overloadUntil) return false
	bucket.joinTimestamps = bucket.joinTimestamps.filter(t => now - t < 60_000)
	if (bucket.joinTimestamps.length >= maxJoinsPerMin) {
		bucket.overloadUntil = now + overloadCooldownMs
		return false
	}
	if (peerId && bucket.active.has(peerId)) return true
	if (bucket.active.size >= maxActive) {
		bucket.overloadUntil = now + overloadCooldownMs
		return false
	}
	bucket.joinTimestamps.push(now)
	if (peerId) bucket.active.add(peerId)
	return true
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
