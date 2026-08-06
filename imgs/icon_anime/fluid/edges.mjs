/**
 * 重力相对边界几何：分数边角色、环绕与邻格（无动力学副作用）。
 *
 * 四边同时持有 sink / source / wrap 权重（和为 1）：
 *   sink   = max(0,  n̂·ĝ)  — 重力穿出（岩浆源 / 水汇）
 *   source = max(0, −n̂·ĝ)  — 重力穿入（出雨 / 天空）
 *   wrap   = 1 − |n̂·ĝ|     — 垂直于重力（环绕）
 */

import { hash01 } from '../hash.mjs'

/** @typedef {import('./world.mjs').FluidWorld} FluidWorld */

/** 边：0 上、1 下、2 左、3 右。 */
export const EDGE_TOP = 0
export const EDGE_BOTTOM = 1
export const EDGE_LEFT = 2
export const EDGE_RIGHT = 3

/** 四边外向法线。 */
export const EDGE_NX = [0, 0, -1, 1]
/** 四边外向法线。 */
export const EDGE_NY = [-1, 1, 0, 0]

/**
 * @typedef {{
 *   nx: number, ny: number,
 *   sink: number, source: number, wrap: number,
 * }} EdgeRole
 */

/** 复用的四边角色缓冲。 */
const ROLES = [
	{ nx: 0, ny: -1, sink: 0, source: 0, wrap: 1 },
	{ nx: 0, ny: 1, sink: 0, source: 0, wrap: 1 },
	{ nx: -1, ny: 0, sink: 0, source: 0, wrap: 1 },
	{ nx: 1, ny: 0, sink: 0, source: 0, wrap: 1 },
]

/**
 * 计算四边分数角色。
 * @param {FluidWorld} world 世界
 * @returns {EdgeRole[]} 长度为 4 的角色（复用缓冲）
 */
export const edgeRoles = (world) => {
	const { gx, gy } = world.gravity
	for (let e = 0; e < 4; e++) {
		const nx = EDGE_NX[e]
		const ny = EDGE_NY[e]
		const dot = nx * gx + ny * gy
		const r = ROLES[e]
		r.nx = nx
		r.ny = ny
		r.sink = Math.max(0, dot)
		r.source = Math.max(0, -dot)
		r.wrap = 1 - Math.abs(dot)
	}
	return ROLES
}

/**
 * 点处「重力穿出」程度（下边性）。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {number} [0, 1]
 */
export const edgeDownness = (world, x, y) => {
	const roles = edgeRoles(world)
	const W = world.worldW
	const H = world.worldH
	let d = 0
	if (y <= 0) d = Math.max(d, roles[EDGE_TOP].sink)
	if (y >= H - 1) d = Math.max(d, roles[EDGE_BOTTOM].sink)
	if (x <= 0) d = Math.max(d, roles[EDGE_LEFT].sink)
	if (x >= W - 1) d = Math.max(d, roles[EDGE_RIGHT].sink)
	return d
}

/**
 * 点处「重力穿入」程度（上边性）。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {number} [0, 1]
 */
export const edgeUpness = (world, x, y) => {
	const roles = edgeRoles(world)
	const W = world.worldW
	const H = world.worldH
	let u = 0
	if (y <= 0) u = Math.max(u, roles[EDGE_TOP].source)
	if (y >= H - 1) u = Math.max(u, roles[EDGE_BOTTOM].source)
	if (x <= 0) u = Math.max(u, roles[EDGE_LEFT].source)
	if (x >= W - 1) u = Math.max(u, roles[EDGE_RIGHT].source)
	return u
}

/**
 * 兼容旧 API：是否在重力下边（sink > 0.5）。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {boolean} 下边
 */
export const onDownEdge = (world, x, y) => edgeDownness(world, x, y) > 0.5

/**
 * 兼容旧 API：是否在重力上边（source > 0.5）。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {boolean} 上边
 */
export const onUpEdge = (world, x, y) => edgeUpness(world, x, y) > 0.5

/**
 * 将坐标按指定边环绕。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} edge 边索引
 * @returns {{ x: number, y: number }} 环绕后
 */
export const wrapAcrossEdge = (world, x, y, edge) => {
	const W = world.worldW
	const H = world.worldH
	if (edge === EDGE_LEFT || edge === EDGE_RIGHT) {
		let nx = x % W
		if (nx < 0) nx += W
		return { x: nx, y }
	}
	let ny = y % H
	if (ny < 0) ny += H
	return { x, y: ny }
}

/**
 * 将垂直于重力的坐标取模环绕（兼容旧调用）。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {{ x: number, y: number }} 环绕后坐标
 */
export const wrapSide = (world, x, y) => {
	const roles = edgeRoles(world)
	const W = world.worldW
	const H = world.worldH
	let nx = x
	let ny = y
	if (nx < 0 || nx >= W) {
		const edge = nx < 0 ? EDGE_LEFT : EDGE_RIGHT
		if (roles[edge].wrap > 0.15) {
			const w = wrapAcrossEdge(world, nx, ny, edge)
			nx = w.x
			ny = w.y
		}
	}
	if (ny < 0 || ny >= H) {
		const edge = ny < 0 ? EDGE_TOP : EDGE_BOTTOM
		if (roles[edge].wrap > 0.15) {
			const w = wrapAcrossEdge(world, nx, ny, edge)
			nx = w.x
			ny = w.y
		}
	}
	return { x: nx, y: ny }
}

/**
 * 邻格坐标：按 wrap 权重分数拆分环绕与出界。
 * `wrappedFrac` = 该边 wrap 权重；`outFrac` = 1 − wrap（出界汇份额）。
 * 离散选择（粒子）：`discretePickSalt` 非空时用 hash 按 wrap 概率二选一。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} dx 偏移
 * @param {number} dy 偏移
 * @param {number} [discretePickSalt] 粒子离散选择盐值
 * @returns {{
 *   x: number, y: number,
 *   wrapped: boolean, out: boolean,
 *   wrappedFrac: number, outFrac: number,
 * }} 结果
 */
export const neighborCoord = (world, x, y, dx, dy, discretePickSalt) => {
	const roles = edgeRoles(world)
	let nx = x + dx
	let ny = y + dy
	const W = world.worldW
	const H = world.worldH

	/** @type {number | null} */
	let crossed = null
	if (nx < 0) crossed = EDGE_LEFT
	else if (nx >= W) crossed = EDGE_RIGHT
	else if (ny < 0) crossed = EDGE_TOP
	else if (ny >= H) crossed = EDGE_BOTTOM

	if (crossed === null)
		return { x: nx, y: ny, wrapped: false, out: false, wrappedFrac: 0, outFrac: 0 }

	const wrap = roles[crossed].wrap
	const outFrac = 1 - wrap

	if (discretePickSalt !== undefined) {
		const pick = hash01((x | 0) + (y | 0) * 97, discretePickSalt | 0)
		if (pick < wrap) {
			const w = wrapAcrossEdge(world, nx, ny, crossed)
			return { x: w.x, y: w.y, wrapped: true, out: false, wrappedFrac: wrap, outFrac }
		}
		return { x: nx, y: ny, wrapped: false, out: true, wrappedFrac: wrap, outFrac }
	}

	if (wrap >= 0.999) {
		const w = wrapAcrossEdge(world, nx, ny, crossed)
		return { x: w.x, y: w.y, wrapped: true, out: false, wrappedFrac: 1, outFrac: 0 }
	}
	if (wrap <= 0.001)
		return { x: nx, y: ny, wrapped: false, out: true, wrappedFrac: 0, outFrac: 1 }

	// Fractional: report wrapped target + fractions; caller splits mass.
	const w = wrapAcrossEdge(world, nx, ny, crossed)
	return { x: w.x, y: w.y, wrapped: true, out: false, wrappedFrac: wrap, outFrac }
}

/**
 * 兼容旧 API：量化轴角色（由最大 sink 边推断）。
 * @param {FluidWorld} world 世界
 * @returns {{ downAxis: 0|1, downSign: 1|-1, wrapAxis: 0|1 }} 角色
 */
export const boundaryAxes = (world) => {
	const roles = edgeRoles(world)
	let best = EDGE_BOTTOM
	for (let e = 0; e < 4; e++)
		if (roles[e].sink > roles[best].sink) best = e
	if (best === EDGE_TOP) return { downAxis: 1, downSign: -1, wrapAxis: 0 }
	if (best === EDGE_BOTTOM) return { downAxis: 1, downSign: 1, wrapAxis: 0 }
	if (best === EDGE_LEFT) return { downAxis: 0, downSign: -1, wrapAxis: 1 }
	return { downAxis: 0, downSign: 1, wrapAxis: 1 }
}
