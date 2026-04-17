/**
 * 混合逻辑时钟：{ wall: ms, logical: number }
 *
 * @param {{ wall?: number, logical?: number }} prev 上一拍 HLC；缺省视为 0
 * @param {number} [physicalMs] 本地物理时间毫秒戳，默认 `Date.now()`
 * @returns {{ wall: number, logical: number }} 单调非减的下一拍 HLC
 */
export function nextHlc(prev, physicalMs = Date.now()) {
	const p = prev && typeof prev.wall === 'number' ? prev : { wall: 0, logical: 0 }
	if (physicalMs > p.wall) return { wall: physicalMs, logical: 0 }
	if (physicalMs === p.wall) return { wall: p.wall, logical: (p.logical || 0) + 1 }
	return { wall: p.wall, logical: (p.logical || 0) + 1 }
}

/**
 * HLC tiebreaker 比较：先比 wall，再比 logical，最后用节点 id 字典序
 *
 * @param {{ wall: number, logical: number }} a 节点 A 的事件时间戳
 * @param {{ wall: number, logical: number }} b 节点 B 的事件时间戳
 * @param {string} nodeIdA 节点 A 的稳定 id（用于同拍决胜）
 * @param {string} nodeIdB 节点 B 的稳定 id
 * @returns {number} 与 `Array.prototype.sort` 一致：小于 0 表示 a 优先于 b
 */
export function compareHlcNode(a, b, nodeIdA, nodeIdB) {
	if (a.wall !== b.wall) return a.wall - b.wall
	if (a.logical !== b.logical) return a.logical - b.logical
	return String(nodeIdA).localeCompare(String(nodeIdB))
}
