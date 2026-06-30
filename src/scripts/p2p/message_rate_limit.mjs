/**
 * 群级消息限速纯函数（无 I/O，供单测与 governance 复用）。
 */

/**
 * @param {object} event DAG 事件
 * @returns {string} 限速实体键
 */
export function messageRateEntityKey(event) {
	const charId = String(event?.charId || '').trim()
	if (charId) return `char:${charId}`
	return String(event?.sender || '').trim().toLowerCase()
}

/**
 * @param {object} groupSettings 群设置
 * @returns {{ perMin: number, windowMs: number }} 每分钟条数与窗口毫秒
 */
export function resolveMessageRateLimits(groupSettings) {
	const perMin = Math.max(1, Math.min(120, Number(groupSettings?.messageRateLimitPerMin) || 10))
	const windowMs = Math.max(10_000, Number(groupSettings?.messageRateLimitWindowMs) || 60_000)
	return { perMin, windowMs }
}
