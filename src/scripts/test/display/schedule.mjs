/**
 * 消费端渲染 `schedule-update`：总剩余 + 变化原因 + 在跑项。
 */
import { console } from '../../i18n/bare.mjs'
import { formatDuration } from '../core/format_duration.mjs'
import { formatScheduleReason } from '../kernel/schedule_event.mjs'

/**
 * @param {object} message schedule-update 事件
 * @param {number | null} prevCompletionMs 上次展示的 lastCompletionMs
 * @returns {void}
 */
export function paintScheduleUpdate(message, prevCompletionMs) {
	const ms = message.lastCompletionMs
	if (ms == null || !Number.isFinite(ms))
		console.logI18n('fountConsole.test.display.remainingOnlyUnknown', { count: message.unknownCount ?? 0 })
	else
		console.logI18n('fountConsole.test.display.remaining', { remaining: formatDuration(ms) })

	if (prevCompletionMs != null && message.reason && message.reason !== 'initial') {
		const detail = message.reasonDetail ? ` ${message.reasonDetail}` : ''
		console.logI18n('fountConsole.test.display.schedule.reason', { reason: formatScheduleReason(message.reason) + detail })
	}

	for (const r of message.running ?? []) {
		const remaining = r.remainingMs == null ? '?' : formatDuration(r.remainingMs)
		console.logI18n('fountConsole.test.display.schedule.running', { key: r.key, remaining })
	}
}
