/**
 * 混合逻辑时钟：{ wall: ms, logical: number }
 * @param {{ wall?: number, logical?: number }} prev
 * @param {number} [physicalMs]
 * @returns {{ wall: number, logical: number }}
 */
export function nextHlc(prev, physicalMs = Date.now()) {
	const p = prev && typeof prev.wall === 'number' ? prev : { wall: 0, logical: 0 }
	if (physicalMs > p.wall) return { wall: physicalMs, logical: 0 }
	if (physicalMs === p.wall) return { wall: p.wall, logical: (p.logical || 0) + 1 }
	return { wall: p.wall, logical: (p.logical || 0) + 1 }
}

/**
 * HLC tiebreaker 比较：a < b 返回负数
 * @param {{ wall: number, logical: number }} a
 * @param {{ wall: number, logical: number }} b
 * @param {string} nodeIdA
 * @param {string} nodeIdB
 */
export function compareHlcNode(a, b, nodeIdA, nodeIdB) {
	if (a.wall !== b.wall) return a.wall - b.wall
	if (a.logical !== b.logical) return a.logical - b.logical
	return String(nodeIdA).localeCompare(String(nodeIdB))
}
