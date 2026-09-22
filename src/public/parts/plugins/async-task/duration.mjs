/**
 * 【文件】src/public/parts/plugins/async-task/duration.mjs
 * 【职责】异步任务共用的时长解析：把 `90s` / `5m` / `1h` / `2d` / 纯秒数解析为毫秒，并提供默认等待时长。
 * 【原理】宽容解析（无法解析返回 null，交由调用方回退默认值），供 sub-agent 与 async-task 的 `<await-async time-limit>` 复用。
 * 【关联】async-task/handler.mjs、sub-agent/runtime.mjs（转导出给其 handler 与测试）。
 */
import { ms } from '../../../../scripts/ms.mjs'

/** 默认等待异步任务的超时（毫秒）。 */
export const DEFAULT_AWAIT_TIMEOUT_MS = ms('3m')

/**
 * 把 `90s` / `5m` / `1h` / `2d` / 纯秒数解析为毫秒。
 * @param {string | number | null | undefined} value 时长声明
 * @returns {number | null} 毫秒数；无法解析返回 null
 */
export function parseDurationMs(value) {
	if (value == null || value === '') return null
	if (typeof value === 'number') return Number.isFinite(value) ? value : null
	const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?\s*$/i.exec(String(value))
	if (!match) return null
	const amount = Number(match[1])
	const unit = (match[2] ?? 's').toLowerCase()
	const factor = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]
	return Math.round(amount * factor)
}
