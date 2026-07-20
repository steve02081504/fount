/**
 * @param {number} value 输入
 * @param {number} min 下限
 * @param {number} max 上限
 * @returns {number} 限制在 [min, max] 内的数值
 */
export function clampNumber(value, min, max) {
	return Math.min(max, Math.max(min, value))
}
