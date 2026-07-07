import { geti18n } from '../../i18n/bare.mjs'

/**
 * @param {number | null | undefined} ms 毫秒
 * @returns {string} 可读时长
 */
export function formatDuration(ms) {
	if (ms == null) return '—'
	if (ms < 1000) return geti18n('fountConsole.test.report.durationMs', { ms })
	const sec = Math.round(ms / 1000)
	if (sec < 60) return geti18n('fountConsole.test.report.durationSec', { sec })
	const min = Math.floor(sec / 60)
	const rem = sec % 60
	return rem
		? geti18n('fountConsole.test.report.durationMinSec', { min, sec: rem })
		: geti18n('fountConsole.test.report.durationMin', { min })
}
