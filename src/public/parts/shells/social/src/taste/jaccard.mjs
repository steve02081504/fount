/**
 * 加权 Jaccard（口味聚类 / 合并验证共用）。
 * @param {Map<string, number>} left 加权集合
 * @param {Map<string, number>} right 加权集合
 * @returns {number} 加权 Jaccard
 */
export function weightedJaccard(left, right) {
	if (!left?.size || !right?.size) return 0
	let inter = 0
	let union = 0
	const keys = new Set([...left.keys(), ...right.keys()])
	for (const key of keys) {
		const a = left.get(key) || 0
		const b = right.get(key) || 0
		inter += Math.min(a, b)
		union += Math.max(a, b)
	}
	return union > 0 ? inter / union : 0
}
