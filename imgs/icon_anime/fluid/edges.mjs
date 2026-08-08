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
/** 下边（屏幕向下时 y = H−1）。 */
export const EDGE_BOTTOM = 1
/** 左边（x = 0）。 */
export const EDGE_LEFT = 2
/** 右边（x = W−1）。 */
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

/** `wrapAcrossEdge` 复用结果（勿长期持有）。 */
const WRAP_XY = { x: 0, y: 0 }

/**
 * 将坐标按世界尺寸取模环绕（两轴均归一化）。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} [_edge] 穿过的边（保留签名兼容）
 * @returns {{ x: number, y: number }} 环绕后（复用缓冲）
 */
export const wrapAcrossEdge = (world, x, y, _edge) => {
	const W = world.worldW
	const H = world.worldH
	let nx = x % W
	if (nx < 0) nx += W
	let ny = y % H
	if (ny < 0) ny += H
	WRAP_XY.x = nx
	WRAP_XY.y = ny
	return WRAP_XY
}

/**
 * @typedef {{
 *   x: number, y: number,
 *   wrapped: boolean, out: boolean,
 *   wrappedFrac: number, outFrac: number,
 * }} NeighborCoord
 */

/** `neighborCoord` 复用结果（勿嵌套调用 / 勿跨 tick 持有）。 */
const NEIGHBOR = {
	x: 0, y: 0,
	wrapped: false, out: false,
	wrappedFrac: 0, outFrac: 0,
}

/**
 * 就地取模环绕，写入 `outX/outY` 字段到 NEIGHBOR。
 * @param {number} W 宽
 * @param {number} H 高
 * @param {number} x 列
 * @param {number} y 行
 * @returns {void}
 */
const setWrappedXY = (W, H, x, y) => {
	let nx = x % W
	if (nx < 0) nx += W
	let ny = y % H
	if (ny < 0) ny += H
	NEIGHBOR.x = nx
	NEIGHBOR.y = ny
}

/**
 * 邻格坐标：按 wrap 权重分数拆分环绕与出界。
 * `wrappedFrac` = 该边 wrap 权重；`outFrac` = 1 − wrap（出界汇份额）。
 * 离散选择（粒子）：`discretePickSalt` 非空时用 hash 按 wrap 概率二选一。
 * 返回模块内复用对象。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} dx 偏移
 * @param {number} dy 偏移
 * @param {number} [discretePickSalt] 粒子离散选择盐值
 * @returns {NeighborCoord} 结果
 */
export const neighborCoord = (world, x, y, dx, dy, discretePickSalt) => {
	const roles = edgeRoles(world)
	const nx = x + dx
	const ny = y + dy
	const W = world.worldW
	const H = world.worldH

	/** @type {number | null} */
	let crossed = null
	if (nx < 0) crossed = EDGE_LEFT
	else if (nx >= W) crossed = EDGE_RIGHT
	else if (ny < 0) crossed = EDGE_TOP
	else if (ny >= H) crossed = EDGE_BOTTOM

	if (crossed === null) {
		NEIGHBOR.x = nx
		NEIGHBOR.y = ny
		NEIGHBOR.wrapped = false
		NEIGHBOR.out = false
		NEIGHBOR.wrappedFrac = 0
		NEIGHBOR.outFrac = 0
		return NEIGHBOR
	}

	const wrap = roles[crossed].wrap
	const outFrac = 1 - wrap

	if (discretePickSalt !== undefined) {
		const pick = hash01((x | 0) + (y | 0) * 97, discretePickSalt | 0)
		if (pick < wrap) {
			setWrappedXY(W, H, nx, ny)
			NEIGHBOR.wrapped = true
			NEIGHBOR.out = false
			NEIGHBOR.wrappedFrac = wrap
			NEIGHBOR.outFrac = outFrac
			return NEIGHBOR
		}
		NEIGHBOR.x = nx
		NEIGHBOR.y = ny
		NEIGHBOR.wrapped = false
		NEIGHBOR.out = roles[crossed].sink > 0.001
		NEIGHBOR.wrappedFrac = wrap
		NEIGHBOR.outFrac = outFrac
		return NEIGHBOR
	}

	if (wrap >= 0.999) {
		setWrappedXY(W, H, nx, ny)
		NEIGHBOR.wrapped = true
		NEIGHBOR.out = false
		NEIGHBOR.wrappedFrac = 1
		NEIGHBOR.outFrac = 0
		return NEIGHBOR
	}
	if (wrap <= 0.001) {
		NEIGHBOR.x = nx
		NEIGHBOR.y = ny
		NEIGHBOR.wrapped = false
		NEIGHBOR.out = true
		NEIGHBOR.wrappedFrac = 0
		NEIGHBOR.outFrac = 1
		return NEIGHBOR
	}

	// Fractional: report wrapped target + fractions; caller splits mass.
	setWrappedXY(W, H, nx, ny)
	NEIGHBOR.wrapped = true
	NEIGHBOR.out = false
	NEIGHBOR.wrappedFrac = wrap
	NEIGHBOR.outFrac = outFrac
	return NEIGHBOR
}
