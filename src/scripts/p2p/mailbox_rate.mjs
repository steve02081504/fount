/**
 * Mailbox 入站 put 限速（按来源节点，节点级单例）。
 */

const DEFAULT_WINDOW_MS = 60_000
const DEFAULT_MAX_PUTS = 20
const MAX_KEYS = 8000
const EXPIRE_SWEEP_BATCH = 64

/** @type {Map<string, { count: number, resetAt: number }>} */
const inboundByKey = new Map()

/**
 * @param {object} [limits] 可选限额
 * @returns {{ windowMs: number, maxPuts: number }} 生效限额
 */
export function resolveMailboxRateLimits(limits = {}) {
	return {
		windowMs: Math.max(1000, Number(limits.windowMs) || DEFAULT_WINDOW_MS),
		maxPuts: Math.max(1, Math.min(256, Number(limits.maxPuts) || DEFAULT_MAX_PUTS)),
	}
}

/**
 * @param {string} fromNodeHash 来源节点
 * @returns {string} 限速键
 */
export function mailboxRateKey(fromNodeHash) {
	return String(fromNodeHash || '').trim()
}

/**
 * @param {number} now 当前时间戳
 * @returns {void}
 */
function sweepExpiredEntries(now) {
	let scanned = 0
	for (const [rateKey, rateEntry] of inboundByKey) {
		if (now > rateEntry.resetAt) inboundByKey.delete(rateKey)
		if (++scanned >= EXPIRE_SWEEP_BATCH) break
	}
}

/**
 * @param {string} key 限速键
 * @returns {void}
 */
function touchLruKey(key) {
	const entry = inboundByKey.get(key)
	if (!entry) return
	inboundByKey.delete(key)
	inboundByKey.set(key, entry)
}

/**
 * @param {string} key 新插入键
 * @returns {void}
 */
function evictLruIfNeeded(key) {
	if (inboundByKey.has(key) || inboundByKey.size < MAX_KEYS) return
	const oldest = inboundByKey.keys().next().value
	if (oldest != null) inboundByKey.delete(oldest)
}

/**
 * @param {string} fromNodeHash 来源节点
 * @param {object} [limits] 可选限额
 * @returns {boolean} 允许新 put 则为 true
 */
export function takeIncomingMailboxPutSlot(fromNodeHash, limits) {
	const { windowMs, maxPuts } = resolveMailboxRateLimits(limits)
	const key = mailboxRateKey(fromNodeHash)
	const now = Date.now()
	if (inboundByKey.size >= MAX_KEYS) sweepExpiredEntries(now)
	evictLruIfNeeded(key)
	let entry = inboundByKey.get(key)
	if (!entry || now > entry.resetAt) entry = { count: 0, resetAt: now + windowMs }
	if (entry.count >= maxPuts) {
		touchLruKey(key)
		return false
	}
	entry.count++
	inboundByKey.set(key, entry)
	touchLruKey(key)
	return true
}
