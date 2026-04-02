/**
 * 将持续时间字符串转换为毫秒。
 * @param {string|number} duration - 持续时间字符串 (例如, "1d", "2h", "30m", "10s") 或毫秒数。
 * @returns {number} 持续时间（以毫秒为单位）。
 */
export function ms(duration) {
	if (Object(duration) instanceof Number) return duration

	const match = /(\d+)\s*(\w+)/.exec(duration)
	if (!match)
		throw new Error('Invalid duration format')

	const value = Number(match[1])
	const unit = match[2]

	switch (unit) {
		case 's':
			return value * 1000
		case 'm':
			return value * 60 * 1000
		case 'h':
			return value * 60 * 60 * 1000
		case 'd':
			return value * 24 * 60 * 60 * 1000
		default:
			throw new Error('Invalid duration unit')
	}
}

/**
 * 将毫秒数格式化为人类可读英文时长（用于错误提示等）。
 * @param {number} msVal - 毫秒数
 * @returns {string} 人类可读英文时长
 */
export function msstr(msVal) {
	const msPositive = Math.max(0, msVal)
	const totalSec = Math.max(1, Math.ceil(msPositive / 1000))
	const m = Math.floor(totalSec / 60)
	const rs = totalSec % 60
	if (m === 0) return `${totalSec}s`
	if (rs === 0) return `${m}min`
	return `${m}m${rs}s`
}
