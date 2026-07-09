import { geti18n } from '../../i18n/bare.mjs'

const SEC_PER_MIN = 60
const SEC_PER_HOUR = 60 * SEC_PER_MIN
const SEC_PER_DAY = 24 * SEC_PER_HOUR

const I18N = 'fountConsole.test.report'

/**
 * @param {number} sec 秒
 * @returns {{ day: number, hour: number, min: number, sec: number }} 分解后的时长
 */
function splitDurationSec(sec) {
	return {
		day: Math.floor(sec / SEC_PER_DAY),
		hour: Math.floor((sec % SEC_PER_DAY) / SEC_PER_HOUR),
		min: Math.floor((sec % SEC_PER_HOUR) / SEC_PER_MIN),
		sec: sec % SEC_PER_MIN,
	}
}

/**
 * @param {number} n 数值
 * @param {string} key i18n 键（相对 report 段）
 * @returns {string} 带单位的片段
 */
function unit(n, key) {
	return geti18n(`${I18N}.${key}`, { n })
}

/**
 * @param {number | null | undefined} ms 毫秒
 * @returns {string} 可读时长
 */
export function formatDuration(ms) {
	if (ms == null) return '—'
	if (ms < 1000) return geti18n(`${I18N}.durationMs`, { ms })

	const sec = Math.round(ms / 1000)
	if (sec < SEC_PER_MIN) return unit(sec, 'durationUnitSec')

	const { day, hour, min, sec: remSec } = splitDurationSec(sec)
	/** @type {string[]} */
	const parts = []
	if (day > 0) parts.push(unit(day, 'durationUnitDay'))
	if (hour > 0) parts.push(unit(hour, 'durationUnitHour'))
	if (min > 0) {
		parts.push(remSec > 0
			? unit(min, 'durationUnitMin')
			: unit(min, 'durationUnitMinute'))
	}
	if (remSec > 0 || parts.length === 0)
		parts.push(unit(remSec, 'durationUnitSec'))

	return parts.join(' ')
}
