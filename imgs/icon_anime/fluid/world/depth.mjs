/**
 * 重力投影深度、邻接权重与自由面判定。
 */

import { NEIGH8_DX, NEIGH8_DY, NEIGH8_UX, NEIGH8_UY, ORTHO_DX, ORTHO_DY } from '../../hash.mjs'
import { isLiquidBarrier } from '../mat.mjs'

import { isCondensed } from './cells.mjs'
import { scratch, inWorld, recomputeGravityDepthBasis } from './create.mjs'

/** @typedef {import('./create.mjs').FluidWorld} FluidWorld */
/** @typedef {import('../../gravity.mjs').GravityState} GravityState */

/** 重力方向点积变化超过此值时标脏空气几何。 */
const GRAVITY_DIRTY_DOT = 0.92

/** 复用的加权邻格缓冲（向下，正交）。 */
const DOWN_W = {
	dx: [0, 0, 0, 0, 0, 0, 0, 0],
	dy: [0, 0, 0, 0, 0, 0, 0, 0],
	w: [0, 0, 0, 0, 0, 0, 0, 0],
	n: 0,
}
/** 复用的加权邻格缓冲（向上，正交）。 */
const UP_W = {
	dx: [0, 0, 0, 0, 0, 0, 0, 0],
	dy: [0, 0, 0, 0, 0, 0, 0, 0],
	w: [0, 0, 0, 0, 0, 0, 0, 0],
	n: 0,
}
/** 沉降用下向（可含对角）。 */
const SETTLE_DOWN_W = {
	dx: [0, 0, 0, 0, 0, 0, 0, 0],
	dy: [0, 0, 0, 0, 0, 0, 0, 0],
	w: [0, 0, 0, 0, 0, 0, 0, 0],
	n: 0,
}
/** 复用的侧向（⊥ĝ）加权正交邻格。 */
const SIDE_W = { dx: [0, 0, 0, 0], dy: [0, 0, 0, 0], w: [0, 0, 0, 0], n: 0 }

/** |gx|、|gy| 均超过此值时启用对角邻接（避免纯轴向下虚假斜流）。 */
const DIAG_TILT_MIN = 0.28

/**
 * 用当前重力填充下/上向加权邻格缓冲。
 * 权重 = 物理单位步向 · ĝ（预计算 `NEIGH8_UX/UY`）；可选对角。
 * @param {FluidWorld} world 世界
 * @param {{ dx: number[], dy: number[], w: number[], n: number }} out 输出
 * @param {number} sense +1 向下，-1 向上
 * @param {boolean} [diagonals=false] 是否在倾斜时加入对角
 * @returns {{ dx: number[], dy: number[], w: number[], n: number }} out
 */
const fillGravityWeights = (world, out, sense, diagonals = false) => {
	const gx = world.gravity.gx * sense
	const gy = world.gravity.gy * sense
	const tilted = diagonals
		&& gx * gx > DIAG_TILT_MIN * DIAG_TILT_MIN
		&& gy * gy > DIAG_TILT_MIN * DIAG_TILT_MIN
	out.n = 0
	const nCand = tilted ? 8 : 4
	for (let c = 0; c < nCand; c++) {
		const dot = NEIGH8_UX[c] * gx + NEIGH8_UY[c] * gy
		if (dot <= 1e-6) continue
		const i = out.n++
		out.dx[i] = NEIGH8_DX[c]
		out.dy[i] = NEIGH8_DY[c]
		out.w[i] = dot
	}
	return out
}

/**
 * 重力投影深度（沿 ĝ 增大；默认 ĝ=(0,1) 时等于 y）。
 * 格点步长空间 — 静水 / Torricelli 标定；视觉 CELL_ASPECT 只影响邻接 û 与渲染半径。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {number} 深度标量
 */
export const gravityDepth = (world, x, y) =>
	x * world.gravity.gx + y * world.gravity.gy - world.gravityDepth0

/**
 * 填充每格重力深度 scratch（同行共享 `y·gy − depth0`）。
 * 同一重力基（gx/gy/depth0/尺寸）下复用，避免 tick 内多次 O(WH) 重写。
 * @param {FluidWorld} world 世界
 * @returns {Float32Array} 长度 WH 的深度场
 */
export const fillCellDepths = (world) => {
	const { worldW: W, worldH: H, gravity: { gx, gy }, gravityDepth0 } = world
	const n = W * H
	const depth = scratch(world, 'cellDepth', n, Float32Array)
	let basis = /** @type {{ gx: number, gy: number, depth0: number, W: number, H: number } | undefined} */ world.scratch.cellDepthBasis

	if (!basis) {
		basis = { gx: NaN, gy: NaN, depth0: NaN, W: 0, H: 0 }
		world.scratch.cellDepthBasis = basis
	}
	if (basis.gx === gx && basis.gy === gy && basis.depth0 === gravityDepth0 && basis.W === W && basis.H === H)
		return depth
	for (let y = 0; y < H; y++) {
		const row = y * W
		const base = y * gy - gravityDepth0
		for (let x = 0; x < W; x++)
			depth[row + x] = x * gx + base
	}
	basis.gx = gx
	basis.gy = gy
	basis.depth0 = gravityDepth0
	basis.W = W
	basis.H = H
	// Depth changed → thermo table / depth orders are stale.
	world.scratch.thermoPEpoch = -1
	world.scratch.depthOrderBasis = null
	return depth
}

/**
 * 桶索引：投影深度 → counting-sort 槽。
 * @param {number} d 深度
 * @param {number} scale 桶缩放
 * @param {number} depthBuckets 桶数
 * @returns {number} 桶
 */
const depthBucket = (d, scale, depthBuckets) =>
	Math.min(depthBuckets - 1, Math.max(0, (d * scale) | 0))

/** 深度序返回壳。 */
const DEPTH_ORDERS_OUT = {
	/** @type {Int32Array | null} */
	shallow: null,
	/** @type {Int32Array | null} */
	deep: null,
}

/**
 * 按投影深度 counting-sort 同时产出浅→深与深→浅序（共享一次分桶计数）。
 * 同一重力基下复用，避免 tick 内多次 O(WH) 重排。
 * @param {FluidWorld} world 世界
 * @param {string} shallowKey 浅→深 order scratch 键
 * @param {string} deepKey 深→浅 order scratch 键
 * @param {string} countsKey 桶计数 scratch 键
 * @param {Float32Array} [depth] 已有深度场；缺省则 `fillCellDepths`
 * @returns {{ shallow: Int32Array, deep: Int32Array }} 两序（复用壳）
 */
export const buildDepthOrders = (world, shallowKey, deepKey, countsKey, depth) => {
	const { worldW: W, worldH: H, gravity: { gx, gy }, gravityDepth0 } = world
	const n = W * H
	const d = depth || fillCellDepths(world)
	const shallow = scratch(world, shallowKey, n, Int32Array)
	const deep = scratch(world, deepKey, n, Int32Array)
	let basis = /** @type {{ gx: number, gy: number, depth0: number, W: number, H: number, shallowKey: string, deepKey: string } | undefined} */ world.scratch.depthOrderBasis

	if (
		basis
		&& basis.gx === gx && basis.gy === gy && basis.depth0 === gravityDepth0
		&& basis.W === W && basis.H === H
		&& basis.shallowKey === shallowKey && basis.deepKey === deepKey
	) {
		DEPTH_ORDERS_OUT.shallow = shallow
		DEPTH_ORDERS_OUT.deep = deep
		return DEPTH_ORDERS_OUT
	}

	const depthBuckets = Math.max(W, H) + 2
	const dCounts = scratch(world, countsKey, depthBuckets, Int32Array)
	const cursors = scratch(world, `${countsKey}Cur`, depthBuckets, Int32Array)
	dCounts.fill(0)
	const scale = (depthBuckets - 1) / (world.gravityDepthSpan || 1)
	for (let cell = 0; cell < n; cell++)
		dCounts[depthBucket(d[cell], scale, depthBuckets)]++

	let run = 0
	for (let b = 0; b < depthBuckets; b++) {
		cursors[b] = run
		run += dCounts[b]
	}
	for (let cell = 0; cell < n; cell++) {
		const b = depthBucket(d[cell], scale, depthBuckets)
		shallow[cursors[b]++] = cell
	}

	run = 0
	for (let b = depthBuckets - 1; b >= 0; b--) {
		cursors[b] = run
		run += dCounts[b]
	}
	for (let cell = 0; cell < n; cell++) {
		const b = depthBucket(d[cell], scale, depthBuckets)
		deep[cursors[b]++] = cell
	}

	if (!basis) {
		basis = { gx, gy, depth0: gravityDepth0, W, H, shallowKey, deepKey }
		world.scratch.depthOrderBasis = basis
	}
	else {
		basis.gx = gx
		basis.gy = gy
		basis.depth0 = gravityDepth0
		basis.W = W
		basis.H = H
		basis.shallowKey = shallowKey
		basis.deepKey = deepKey
	}
	DEPTH_ORDERS_OUT.shallow = shallow
	DEPTH_ORDERS_OUT.deep = deep
	return DEPTH_ORDERS_OUT
}

/**
 * 按投影深度 counting-sort 填满网格序（浅→深或深→浅）。
 * @param {FluidWorld} world 世界
 * @param {string} orderKey order scratch 键
 * @param {string} countsKey 桶计数 scratch 键
 * @param {boolean} reverse true = 深→浅
 * @param {Float32Array} [depth] 已有深度场；缺省则 `fillCellDepths`
 * @returns {Int32Array} 长度 WH 的格序
 */
export const buildDepthOrder = (world, orderKey, countsKey, reverse, depth) => {
	const { worldW: W, worldH: H } = world
	const n = W * H
	const d = depth || fillCellDepths(world)
	const order = scratch(world, orderKey, n, Int32Array)
	const depthBuckets = Math.max(W, H) + 2
	const dCounts = scratch(world, countsKey, depthBuckets, Int32Array)
	dCounts.fill(0)
	const scale = (depthBuckets - 1) / (world.gravityDepthSpan || 1)
	for (let cell = 0; cell < n; cell++)
		dCounts[depthBucket(d[cell], scale, depthBuckets)]++
	let run = 0
	if (reverse)
		for (let b = depthBuckets - 1; b >= 0; b--) {
			const c = dCounts[b]
			dCounts[b] = run
			run += c
		}
	else
		for (let b = 0; b < depthBuckets; b++) {
			const c = dCounts[b]
			dCounts[b] = run
			run += c
		}
	for (let cell = 0; cell < n; cell++) {
		const b = depthBucket(d[cell], scale, depthBuckets)
		order[dCounts[b]++] = cell
	}
	return order
}

/**
 * 沿重力向下的正交邻格（土壤底面 / 自由面 / 气泡）。w = û_phys·ĝ。
 * @param {FluidWorld} world 世界
 * @returns {{ dx: number[], dy: number[], w: number[], n: number }} 加权邻格
 */
export const gravityDownWeights = (world) => fillGravityWeights(world, DOWN_W, 1, false)

/**
 * 凝聚相沉降邻格：正交 + 倾斜时对角（同一 pressureMove 语言）。
 * @param {FluidWorld} world 世界
 * @returns {{ dx: number[], dy: number[], w: number[], n: number }} 加权邻格
 */
export const gravitySettleWeights = (world) => fillGravityWeights(world, SETTLE_DOWN_W, 1, true)

/**
 * 沿重力向上的正交邻格（w = û_phys·(−ĝ)）。
 * @param {FluidWorld} world 世界
 * @returns {{ dx: number[], dy: number[], w: number[], n: number }} 加权邻格
 */
export const gravityUpWeights = (world) => fillGravityWeights(world, UP_W, -1, false)

/**
 * 垂直于 ĝ 的侧向正交邻格（液膜 / 表面张力）。w = |d̂ × ĝ|（二维叉积模）。
 * @param {FluidWorld} world 世界
 * @returns {{ dx: number[], dy: number[], w: number[], n: number }} 加权邻格
 */
export const gravitySideWeights = (world) => {
	const { gx, gy } = world.gravity
	SIDE_W.n = 0
	for (let o = 0; o < 4; o++) {
		const dx = ORTHO_DX[o]
		const dy = ORTHO_DY[o]
		const cross = Math.abs(dx * gy - dy * gx)
		if (cross <= 1e-6) continue
		const i = SIDE_W.n++
		SIDE_W.dx[i] = dx
		SIDE_W.dy[i] = dy
		SIDE_W.w[i] = cross
	}
	return SIDE_W
}

/** 复用的最强上/下邻格（勿长期持有；勿同时保留 up/down 引用）。 */
const STRONG_UP = { dx: 0, dy: 0, w: 0 }
const STRONG_DOWN = { dx: 0, dy: 0, w: 0 }

/**
 * 从已有上/下向权重里取最强项写入 shell。
 * @param {{ dx: number[], dy: number[], w: number[], n: number }} weights 权重
 * @param {{ dx: number, dy: number, w: number }} out 输出 shell
 * @returns {{ dx: number, dy: number, w: number }} out
 */
const pickStrongest = (weights, out) => {
	if (weights.n <= 0) {
		out.dx = 0
		out.dy = 0
		out.w = 0
		return out
	}
	let best = 0
	for (let i = 1; i < weights.n; i++)
		if (weights.w[i] > weights.w[best]) best = i
	out.dx = weights.dx[best]
	out.dy = weights.dy[best]
	out.w = weights.w[best]
	return out
}

/**
 * 最强上向邻格方向与权重。
 * @param {FluidWorld} world 世界
 * @param {{ dx: number[], dy: number[], w: number[], n: number }} [weights] 已有上向权重；缺省则现算
 * @returns {{ dx: number, dy: number, w: number }} 最强上向
 */
export const strongestUp = (world, weights) =>
	pickStrongest(weights || gravityUpWeights(world), STRONG_UP)

/**
 * 最强下向邻格方向与权重。
 * @param {FluidWorld} world 世界
 * @param {{ dx: number[], dy: number[], w: number[], n: number }} [weights] 已有下向权重；缺省则现算
 * @returns {{ dx: number, dy: number, w: number }} 最强下向
 */
export const strongestDown = (world, weights) =>
	pickStrongest(weights || gravityDownWeights(world), STRONG_DOWN)

/**
 * 自由面格？（所有上向加权邻格皆非凝聚相 / 出界）。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {{ dx: number[], dy: number[], w: number[], n: number }} up 上向权重
 * @returns {boolean} 液体上方是否为空气
 */
export const isLiquidFreeSurface = (world, x, y, up) => {
	if (up.n <= 0) return true
	const { mat, worldW: W } = world
	for (let i = 0; i < up.n; i++) {
		const ux = x + up.dx[i]
		const uy = y + up.dy[i]
		if (!inWorld(world, ux, uy)) continue
		const above = uy * W + ux
		if (!isLiquidBarrier(mat[above]) && isCondensed(world, above))
			return false
	}
	return true
}

/**
 * 将重力状态写入世界；方向转过阈值角时标脏。
 * @param {FluidWorld} world 世界
 * @param {GravityState} g 重力
 * @returns {boolean} 方向是否显著变化
 */
export const applyGravityToWorld = (world, g) => {
	const prev = world.gravity
	const dot = prev.gx * g.gx + prev.gy * g.gy
	const flipped = dot < GRAVITY_DIRTY_DOT
	world.gravity.gx = g.gx
	world.gravity.gy = g.gy
	world.gravity.mag = g.mag
	recomputeGravityDepthBasis(world)
	if (flipped) {
		world.airDirty = true
		world.gasGeomDirty = true
	}
	return flipped
}
