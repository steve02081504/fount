/**
 * @param {unknown} value 输入
 * @param {number} min 下限
 * @param {number} max 上限
 * @param {number} fallback 无效输入时的默认值
 * @returns {number} 限制在 [min, max] 内的数值
 */
export function clampNumber(value, min, max, fallback) {
	const n = Number(value)
	const base = Number.isFinite(n) ? n : fallback
	return Math.min(max, Math.max(min, base))
}
