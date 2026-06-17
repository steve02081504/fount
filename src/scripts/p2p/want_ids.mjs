/**
 * wantIds 限速与退避（§9）：每邻居 QPS/突发、出站批预算、指数退避冷却。
 */

const DEFAULT_IN_WINDOW_MS = 60_000
const DEFAULT_IN_MAX_BATCH = 32
const DEFAULT_OUT_WINDOW_MS = 60_000
const DEFAULT_OUT_MAX_BATCH = 16
const DEFAULT_BACKOFF_BASE_MS = 2_000
const DEFAULT_BACKOFF_MAX_MS = 120_000

/** @type {Map<string, { count: number, resetAt: number }>} */
const inboundByKey = new Map()
/** @type {Map<string, { count: number, resetAt: number }>} */
const outboundByKey = new Map()
/** @type {Map<string, { until: number, strikes: number }>} */
const backoffByKey = new Map()

/**
 * 清理过期速率窗口条目。
 * @param {Map<string, { count: number, resetAt: number }>} map 速率表
 * @param {number} maxSize 触发清理的上限
 * @param {number} now 当前时间戳
 * @returns {void} 无返回值
 */
function pruneRateMap(map, maxSize, now) {
	if (map.size <= maxSize) return
	for (const [k, v] of map)
		if (now > v.resetAt + 120_000) map.delete(k)
}

/**
 * 解析 wantIds 限速参数。
 * @param {object} [limits] 可选覆盖
 * @param {number} [limits.inWindowMs] 入站窗口毫秒
 * @param {number} [limits.inMaxBatch] 入站每窗口批次数
 * @param {number} [limits.outWindowMs] 出站窗口毫秒
 * @param {number} [limits.outMaxBatch] 出站每窗口批次数
 * @returns {{ inWindowMs: number, inMaxBatch: number, outWindowMs: number, outMaxBatch: number }} 生效限额
 */
export function resolveWantIdsLimits(limits = {}) {
	return {
		inWindowMs: Math.max(1000, Number(limits.inWindowMs) || DEFAULT_IN_WINDOW_MS),
		inMaxBatch: Math.max(1, Math.min(256, Number(limits.inMaxBatch) || DEFAULT_IN_MAX_BATCH)),
		outWindowMs: Math.max(1000, Number(limits.outWindowMs) || DEFAULT_OUT_WINDOW_MS),
		outMaxBatch: Math.max(1, Math.min(256, Number(limits.outMaxBatch) || DEFAULT_OUT_MAX_BATCH)),
	}
}

/**
 * @param {string} groupId 群 ID
 * @param {string} peerId 对端节点 id
 * @returns {string} 复合键
 */
export function wantIdsPeerKey(groupId, peerId) {
	return `${groupId}\0${peerId}`
}

/**
 * 出站 want 限速键。
 * @param {string} groupId 群 ID
 * @returns {string} 复合键
 */
export function wantIdsGroupKey(groupId) {
	return groupId
}

/**
 * 是否处于 wantIds 退避冷却。
 * @param {string} key 限速或退避键
 * @returns {boolean} 冷却中则为 true
 */
export function isWantIdsInBackoff(key) {
	const b = backoffByKey.get(key)
	if (!b) return false
	if (Date.now() < b.until) return true
	backoffByKey.delete(key)
	return false
}

/**
 * 记录一次 wantIds 超限并延长退避。
 * @param {string} key 退避键
 * @returns {void} 无返回值
 */
export function recordWantIdsBackoff(key) {
	const now = Date.now()
	const prev = backoffByKey.get(key)
	const strikes = (prev?.strikes ?? 0) + 1
	const delay = Math.min(
		DEFAULT_BACKOFF_MAX_MS,
		DEFAULT_BACKOFF_BASE_MS * 2 ** Math.min(strikes - 1, 6),
	)
	backoffByKey.set(key, { until: now + delay, strikes })
	if (backoffByKey.size > 12_000)
		for (const [k, v] of backoffByKey)
			if (now > v.until) backoffByKey.delete(k)
}

/**
 * 消耗入站 want 配额。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} requesterId 请求方节点 id
 * @param {object} [limits] 可选限额
 * @returns {boolean} 允许处理则为 true
 */
export function takeIncomingWantIdsSlot(groupId, requesterId, limits) {
	const { inWindowMs, inMaxBatch } = resolveWantIdsLimits(limits)
	const peerKey = wantIdsPeerKey(groupId, requesterId)
	if (isWantIdsInBackoff(peerKey)) return false
	const now = Date.now()
	let e = inboundByKey.get(peerKey)
	if (!e || now > e.resetAt) e = { count: 0, resetAt: now + inWindowMs }
	if (e.count >= inMaxBatch) {
		recordWantIdsBackoff(peerKey)
		return false
	}
	e.count++
	inboundByKey.set(peerKey, e)
	pruneRateMap(inboundByKey, 8000, now)
	return true
}

/**
 * 消耗出站 want 配额。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {object} [limits] 可选限额
 * @returns {boolean} 允许发起则为 true
 */
export function takeOutgoingWantIdsSlot(groupId, limits) {
	const { outWindowMs, outMaxBatch } = resolveWantIdsLimits(limits)
	const key = wantIdsGroupKey(groupId)
	if (isWantIdsInBackoff(key)) return false
	const now = Date.now()
	let e = outboundByKey.get(key)
	if (!e || now > e.resetAt) e = { count: 0, resetAt: now + outWindowMs }
	if (e.count >= outMaxBatch) {
		recordWantIdsBackoff(key)
		return false
	}
	e.count++
	outboundByKey.set(key, e)
	pruneRateMap(outboundByKey, 4000, now)
	return true
}

/**
 * 按预算截断 wantIds 列表。
 * @param {string[]} wantIds 缺失事件 id
 * @param {number} budget 单批上限
 * @returns {string[]} 截断后的 id 列表
 */
export function batchWantIds(wantIds, budget) {
	const cap = Math.max(1, Math.min(256, Number(budget) || DEFAULT_OUT_MAX_BATCH))
	return wantIds.slice(0, cap)
}
