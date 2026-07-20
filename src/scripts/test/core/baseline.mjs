/**
 * Suite 运行时采样基线的 EMA 更新（new = (old×N + sample) / (N+1)）。
 */

/** CPU 全机占用率波动大，平滑窗口偏大。 */
export const BASELINE_EMA_CPU = 8

/** 内存峰值中等波动。 */
export const BASELINE_EMA_MEM = 4

/** 墙钟耗时相对稳定。 */
export const BASELINE_EMA_DURATION = 2

/** 并行装箱时全机 CPU 占用上限（%）。 */
export const CPU_BUDGET_PCT = 85

/**
 * @param {number | null | undefined} current 当前基线
 * @param {number | null | undefined} sample 本次采样
 * @param {number} emaN EMA 窗口 N
 * @param {{ min?: number, allowZero?: boolean }} [opts] 校验选项
 * @returns {number | null} 新基线
 */
export function nextBaselineEma(current, sample, emaN, opts = {}) {
	const { min = 0, allowZero = false } = opts
	if (sample == null || !Number.isFinite(sample)) return current ?? null
	if (!allowZero && sample <= min) return current ?? null
	if (current == null) return sample
	return (current * emaN + sample) / (emaN + 1)
}

/**
 * @param {number | null | undefined} current 当前基线 ms
 * @param {number | null | undefined} durationMs 本次耗时
 * @returns {number | null} 新基线 ms
 */
export function nextBaselineDurationMs(current, durationMs) {
	return nextBaselineEma(current, durationMs, BASELINE_EMA_DURATION, { min: 0, allowZero: false })
}

/**
 * @param {number | null | undefined} current 当前基线 MB
 * @param {number | null | undefined} measuredMb 本次峰值 MB
 * @returns {number | null} 新基线 MB
 */
export function nextBaselineMemMb(current, measuredMb) {
	const sample = measuredMb == null ? null : Math.ceil(measuredMb)
	return nextBaselineEma(current, sample, BASELINE_EMA_MEM, { min: 0, allowZero: false })
}

/**
 * @param {number | null | undefined} current 当前基线 %
 * @param {number | null | undefined} avgCpuPct 本次运行期间平均全机 CPU %
 * @returns {number | null} 新基线 %
 */
export function nextBaselineCpuPct(current, avgCpuPct) {
	const sample = avgCpuPct == null ? null : Math.round(avgCpuPct * 10) / 10
	return nextBaselineEma(current, sample, BASELINE_EMA_CPU, { min: 0, allowZero: true })
}

/**
 * @param {number[]} samples 采样序列
 * @returns {number | null} 算术均值
 */
export function meanSample(samples) {
	if (!samples.length) return null
	return samples.reduce((a, b) => a + b, 0) / samples.length
}
