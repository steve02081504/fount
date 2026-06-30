/**
 * 墙钟时长解析（挖矿 `--duration`）。
 */

/**
 * @param {string | boolean | undefined} raw CLI 原始值
 * @returns {number | null} 毫秒；未指定或无效则 null
 */
export function parseDurationMs(raw) {
	if (raw === undefined || raw === true || raw === '') return null
	const text = String(raw).trim().toLowerCase()
	if (!text) return null

	const match = /^(\d+(?:\.\d+)?)(ms|s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)?$/u.exec(text)
	if (!match) return null

	const value = Number(match[1])
	if (!Number.isFinite(value) || value <= 0) return null

	const unit = match[2] || 's'
	switch (unit) {
		case 'ms':
			return Math.floor(value)
		case 's':
		case 'sec':
		case 'secs':
		case 'second':
		case 'seconds':
			return Math.floor(value * 1000)
		case 'm':
		case 'min':
		case 'mins':
		case 'minute':
		case 'minutes':
			return Math.floor(value * 60_000)
		case 'h':
		case 'hr':
		case 'hrs':
		case 'hour':
		case 'hours':
			return Math.floor(value * 3_600_000)
		default:
			return null
	}
}

/**
 * @param {number | null} durationMs 时长上限
 * @param {number} [now=Date.now()] 当前时间
 * @returns {number | null} 截止时间戳；无上限则 null
 */
export function deadlineFromDuration(durationMs, now = Date.now()) {
	if (durationMs == null || durationMs <= 0) return null
	return now + durationMs
}

/**
 * @param {number | null} deadline 截止时间戳
 * @param {number} [now=Date.now()] 当前时间
 * @returns {boolean} 是否已到或超过截止（当前代结束后应停止）
 */
export function pastDeadline(deadline, now = Date.now()) {
	return deadline != null && now >= deadline
}
