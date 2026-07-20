import { formatDuration } from './format_duration.mjs'

/**
 * @typedef {{ reused?: boolean, durationMs?: number | null }} TimedSlot
 */

/**
 * @param {TimedSlot[]} completed 已完成槽位
 * @returns {number} 未复用套件耗时之和（毫秒）
 */
export function sumNonReusedDurationMs(completed) {
	return completed.reduce((sum, slot) => sum + (slot.reused ? 0 : slot.durationMs ?? 0), 0)
}

/**
 * @param {{ startedAt?: string | null, finishedAt?: string | null }} summary 运行汇总
 * @param {number} [nowMs=Date.now()] 当前时间（便于测试注入）
 * @returns {number | null} 墙钟耗时（毫秒）
 */
export function wallClockMs(summary, nowMs = Date.now()) {
	if (!summary.startedAt) return null
	const end = summary.finishedAt ? Date.parse(summary.finishedAt) : nowMs
	return end - Date.parse(summary.startedAt)
}

/**
 * 并行率 = 未复用套件耗时之和 / 总墙钟时间 × 100% − 100%。
 * 串行约 0%；并行越高越正。无真跑耗时（全复用/全阻塞）时无意义，返回 null。
 * @param {number} suiteSumMs 未复用套件耗时之和
 * @param {number | null} totalMs 墙钟总耗时
 * @returns {number | null} 并行率（百分点，可负）
 */
export function parallelRatePct(suiteSumMs, totalMs) {
	if (!suiteSumMs || totalMs == null || totalMs <= 0) return null
	return suiteSumMs / totalMs * 100 - 100
}

/**
 * @param {number | null | undefined} pct 并行率
 * @returns {string} 可读百分比
 */
export function formatParallelRatePct(pct) {
	if (pct == null) return '—'
	return `${Math.round(pct)}%`
}

/**
 * @param {number | null | undefined} baselineDurationMs 基线耗时
 * @returns {string | null} 预期时长；无基线返回 null
 */
export function formatExpectedDuration(baselineDurationMs) {
	if (baselineDurationMs == null || baselineDurationMs <= 0) return null
	return formatDuration(baselineDurationMs)
}

/**
 * @param {TimedSlot[]} completed 已完成槽位
 * @param {{ startedAt?: string | null, finishedAt?: string | null }} summary 运行汇总
 * @param {number} [nowMs] 当前时间
 * @returns {{ suiteSumMs: number, wallClockMs: number | null, parallelRatePct: number | null }} 汇总
 */
export function summarizeRunTiming(completed, summary, nowMs) {
	const suiteSumMs = sumNonReusedDurationMs(completed)
	const totalMs = wallClockMs(summary, nowMs)
	return {
		suiteSumMs,
		wallClockMs: totalMs,
		parallelRatePct: parallelRatePct(suiteSumMs, totalMs),
	}
}
