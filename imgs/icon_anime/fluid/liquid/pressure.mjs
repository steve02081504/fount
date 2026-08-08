/**
 * 自由水静压柱：P_air(表面) + RHO_G·深度。
 * 供水相输运与对外查询（`liquidPressureAt`）。
 */

import { pressureAt } from '../gas.mjs'
import { LIQ_DRAW, RHO_G, isLiquidBarrier } from '../mat.mjs'
import {
	idx, inWorld, scratch, growScratch,
	gravityDepth, gravityUpWeights, strongestUp, strongestDown,
	fillCellDepths, buildDepthOrder,
} from '../world.mjs'

/** @typedef {import('../world.mjs').FluidWorld} FluidWorld */

/** 脏压强种子过多时直接全网重填。 */
const P_DIRTY_FULL_THRESH = 48

/** 压强行走用的上/下向快照（与 `strongest*` 分离，避免中途覆盖）。 */
const UP_LINE = { dx: 0, dy: 0, w: 0 }
const DOWN_LINE = { dx: 0, dy: 0, w: 0 }

/**
 * 静压深度：P_air(表面) + RHO_G·(深度 + 部分填充)。
 * @param {number} airP 自由面行的空气压
 * @param {number} depth 当前深度
 * @param {number} surfDepth 自由面深度
 * @param {number} amount 格内液体填充
 * @returns {number} 该格静压
 */
const columnDepthPressure = (airP, depth, surfDepth, amount) =>
	airP + RHO_G * ((depth - surfDepth) + Math.min(1, Math.max(amount, LIQ_DRAW)))

/**
 * `(x, y)` 处液体静压。
 * @param {FluidWorld} world 流体世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {number} `(x, y)` 液体压力
 */
export const liquidPressureAt = (world, x, y) => {
	if (!inWorld(world, x, y)) return pressureAt(world, x, Math.max(0, y))
	const cell = idx(world, x, y)
	const L = world.liq[cell]
	if (L < LIQ_DRAW && !isLiquidBarrier(world.mat[cell]))
		return pressureAt(world, x, y)

	const up = strongestUp(world)
	let sx = x
	let sy = y
	for (;;) {
		if (up.w <= 0) break
		const nx = sx + up.dx
		const ny = sy + up.dy
		if (!inWorld(world, nx, ny)) break
		const above = idx(world, nx, ny)
		if (isLiquidBarrier(world.mat[above])) break
		if (world.liq[above] < LIQ_DRAW) break
		sx = nx
		sy = ny
	}

	let airX = sx
	let airY = sy
	if (up.w > 0) {
		airX = sx + up.dx
		airY = sy + up.dy
	}
	const airP = inWorld(world, airX, airY) && !isLiquidBarrier(world.mat[idx(world, airX, airY)])
		? pressureAt(world, airX, airY)
		: pressureAt(world, sx, sy)
	return columnDepthPressure(airP, gravityDepth(world, x, y), gravityDepth(world, sx, sy), L)
}

/**
 * 填充整网液体压力缓存。
 * @param {FluidWorld} world 流体世界
 * @param {Float32Array} cache 压力缓冲
 * @param {Float32Array} depth 每格深度
 * @param {Int32Array} order 浅→深序
 * @param {{ dx: number[], dy: number[], w: number[], n: number }} up 上向权重
 * @param {{ dx: number, dy: number, w: number }} strongUp 最强上向
 * @returns {void}
 */
const fillPressureByDepth = (world, cache, depth, order, up, strongUp) => {
	const { worldW: W, mat, liq } = world
	const n = order.length

	for (let si = 0; si < n; si++) {
		const cell = order[si]
		const x = cell % W
		const y = (cell / W) | 0
		const L = liq[cell]
		if (L < LIQ_DRAW || isLiquidBarrier(mat[cell])) {
			cache[cell] = pressureAt(world, x, y)
			continue
		}

		let bestAbove = -1
		let bestW = -1
		for (let i = 0; i < up.n; i++) {
			const ax = x + up.dx[i]
			const ay = y + up.dy[i]
			if (!inWorld(world, ax, ay)) continue
			const above = ay * W + ax
			if (!isLiquidBarrier(mat[above]) && liq[above] >= LIQ_DRAW)
				if (up.w[i] > bestW) {
					bestW = up.w[i]
					bestAbove = above
				}
		}

		if (bestAbove < 0) {
			let airX = x
			let airY = y
			if (strongUp.w > 0) {
				airX = x + strongUp.dx
				airY = y + strongUp.dy
			}
			const airP = inWorld(world, airX, airY) && !isLiquidBarrier(mat[idx(world, airX, airY)])
				? pressureAt(world, airX, airY)
				: pressureAt(world, x, y)
			const dHere = depth[cell]
			cache[cell] = columnDepthPressure(airP, dHere, dHere, L)
		}
		else {
			const dAbove = depth[bestAbove]
			const dHere = depth[cell]
			const fillAbove = Math.min(1, Math.max(liq[bestAbove], LIQ_DRAW))
			const fillHere = Math.min(1, Math.max(L, LIQ_DRAW))
			cache[cell] = cache[bestAbove] + RHO_G * (dHere - dAbove) + RHO_G * (fillHere - fillAbove)
		}
	}
}

/**
 * 沿 ĝ 的 DDA 重力线刷新压力（增量）。
 * @param {FluidWorld} world 世界
 * @param {number} x0 起点列
 * @param {number} y0 起点行
 * @param {Float32Array} cache 压力缓存
 * @param {Float32Array} depth 深度场
 * @param {{ dx: number, dy: number, w: number }} up 最强上向
 * @param {{ dx: number, dy: number, w: number }} down 最强下向
 * @returns {void}
 */
const refreshGravityLine = (world, x0, y0, cache, depth, up, down) => {
	const { worldW: W, worldH: H, mat, liq } = world

	let sx = x0
	let sy = y0
	for (;;) {
		if (!inWorld(world, sx, sy)) break
		const cell = sy * W + sx
		if (isLiquidBarrier(mat[cell]) || liq[cell] < LIQ_DRAW) break
		if (up.w <= 0) break
		const nx = sx + up.dx
		const ny = sy + up.dy
		if (!inWorld(world, nx, ny)) break
		const above = ny * W + nx
		if (isLiquidBarrier(mat[above]) || liq[above] < LIQ_DRAW) break
		sx = nx
		sy = ny
	}

	let airX = sx
	let airY = sy
	if (up.w > 0) {
		airX = sx + up.dx
		airY = sy + up.dy
	}
	const airP = inWorld(world, airX, airY) && !isLiquidBarrier(mat[idx(world, airX, airY)])
		? pressureAt(world, airX, airY)
		: pressureAt(world, sx, sy)
	const surfDepth = depth[sy * W + sx]

	if (inWorld(world, x0, y0)) {
		const cell0 = y0 * W + x0
		const L0 = liq[cell0]
		if (L0 < LIQ_DRAW && !isLiquidBarrier(mat[cell0]))
			cache[cell0] = pressureAt(world, x0, y0)
		else if (!isLiquidBarrier(mat[cell0]))
			cache[cell0] = columnDepthPressure(airP, depth[cell0], surfDepth, L0)
	}

	const steps = Math.max(W, H)
	/**
	 * 沿单向 DDA 传播静压。
	 * @param {number} dx 列步
	 * @param {number} dy 行步
	 * @returns {void}
	 */
	const walk = (dx, dy) => {
		let x = x0
		let y = y0
		for (let s = 0; s < steps; s++) {
			x += dx
			y += dy
			if (!inWorld(world, x, y)) break
			const cell = y * W + x
			if (isLiquidBarrier(mat[cell]) || liq[cell] < LIQ_DRAW) {
				if (liq[cell] < LIQ_DRAW && !isLiquidBarrier(mat[cell]))
					cache[cell] = pressureAt(world, x, y)
				break
			}
			const prevCell = (y - dy) * W + (x - dx)
			const prev = cache[prevCell]
			const fillPrev = Math.min(1, Math.max(liq[prevCell], LIQ_DRAW))
			const fillHere = Math.min(1, Math.max(liq[cell], LIQ_DRAW))
			cache[cell] = prev + RHO_G * (depth[cell] - depth[prevCell]) + RHO_G * (fillHere - fillPrev)
		}
	}
	if (down.w > 0) walk(down.dx, down.dy)
	if (up.w > 0) walk(up.dx, up.dy)
}

/**
 * 构建本 tick 液体静压查询（脏种子惰性刷新）。
 * @param {FluidWorld} world 流体世界
 * @returns {{
 *   pAt: (x: number, y: number) => number,
 *   markDirty: (x: number, y: number) => void,
 *   depth: Float32Array,
 *   upWeights: { dx: number[], dy: number[], w: number[], n: number },
 *   strongUp: { dx: number, dy: number, w: number },
 *   strongDown: { dx: number, dy: number, w: number },
 * }} 压力 API 与重力快照
 */
export const beginLiquidPressure = (world) => {
	const { worldW: W, worldH: H } = world
	const n = W * H
	const depth = fillCellDepths(world)
	const upWeights = gravityUpWeights(world)
	const strongUp = strongestUp(world)
	const strongDown = strongestDown(world)
	UP_LINE.dx = strongUp.dx
	UP_LINE.dy = strongUp.dy
	UP_LINE.w = strongUp.w
	DOWN_LINE.dx = strongDown.dx
	DOWN_LINE.dy = strongDown.dy
	DOWN_LINE.w = strongDown.w

	const order = buildDepthOrder(world, 'liqPFOrder', 'liqPFCounts', false, depth)
	const cache = scratch(world, 'liqP', n, Float32Array)
	fillPressureByDepth(world, cache, depth, order, upWeights, UP_LINE)

	let dirtyX = growScratch(world, 'liqPDirtyX', 64, Int32Array)
	let dirtyY = growScratch(world, 'liqPDirtyY', 64, Int32Array)
	let dirtyN = 0
	let fullRefill = false

	/**
	 * @param {number} x 列
	 * @param {number} y 行
	 * @returns {void}
	 */
	const markDirty = (x, y) => {
		if (fullRefill) return
		if (dirtyN >= P_DIRTY_FULL_THRESH) {
			fullRefill = true
			return
		}
		if (dirtyN >= dirtyX.length) {
			dirtyX = growScratch(world, 'liqPDirtyX', dirtyN + 1, Int32Array)
			dirtyY = growScratch(world, 'liqPDirtyY', dirtyN + 1, Int32Array)
		}
		dirtyX[dirtyN] = x
		dirtyY[dirtyN] = y
		dirtyN++
	}

	/**
	 *
	 */
	const flush = () => {
		if (fullRefill) {
			fillPressureByDepth(world, cache, depth, order, upWeights, UP_LINE)
			fullRefill = false
			dirtyN = 0
			return
		}
		for (let i = 0; i < dirtyN; i++)
			refreshGravityLine(world, dirtyX[i], dirtyY[i], cache, depth, UP_LINE, DOWN_LINE)
		dirtyN = 0
	}

	/**
	 * @param {number} x 列
	 * @param {number} y 行
	 * @returns {number} 缓存的液/气压力
	 */
	const pAt = (x, y) => {
		if (dirtyN || fullRefill) flush()
		if (x < 0 || y < 0 || x >= W || y >= H) return pressureAt(world, x, Math.max(0, y))
		return cache[y * W + x]
	}

	return { pAt, markDirty, depth, upWeights, strongUp, strongDown }
}
