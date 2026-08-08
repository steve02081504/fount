/**
 * 凝聚相静压柱：P_air(表面) + Σ ρ·Δh（水 / 熔岩同一压语）。
 * `liquidPressureAt` 为对外兼容查询；输运用 `condensedPressureAt` / `beginLiquidPressure`。
 */

import { pressureAt } from '../gas/index.mjs'
import { LIQ_DRAW, RHO_G, isLiquidBarrier } from '../mat.mjs'
import { cellRho } from '../thermal.mjs'
import {
	idx, inWorld, scratch, growScratch, cellFill, isCondensed,
	gravityDepth, gravityUpWeights, strongestUp, strongestDown,
	fillCellDepths, buildDepthOrders,
} from '../world/index.mjs'

/** @typedef {import('../world/index.mjs').FluidWorld} FluidWorld */

/** 脏压强种子过多时直接全网重填。 */
const P_DIRTY_FULL_THRESH = 48

/** 压强行走用的上/下向快照（与 `strongest*` 分离，避免中途覆盖）。 */
const UP_LINE = { dx: 0, dy: 0, w: 0 }
const DOWN_LINE = { dx: 0, dy: 0, w: 0 }

/**
 * 本 tick 压力查询上下文（复用壳；`pAt`/`markDirty` 为稳定函数）。
 * @type {{
 *   world: FluidWorld | null,
 *   cache: Float32Array | null,
 *   depth: Float32Array | null,
 *   order: Int32Array | null,
 *   deepOrder: Int32Array | null,
 *   upWeights: { dx: number[], dy: number[], w: number[], n: number } | null,
 *   strongUp: { dx: number, dy: number, w: number } | null,
 *   strongDown: { dx: number, dy: number, w: number } | null,
 *   dirtyX: Int32Array | null,
 *   dirtyY: Int32Array | null,
 *   dirtyN: number,
 *   fullRefill: boolean,
 *   W: number,
 *   H: number,
 *   pAt: (x: number, y: number) => number,
 *   markDirty: (x: number, y: number) => void,
 * }}
 */
const PRESSURE_CTX = {
	world: null,
	cache: null,
	depth: null,
	order: null,
	deepOrder: null,
	upWeights: null,
	strongUp: null,
	strongDown: null,
	dirtyX: null,
	dirtyY: null,
	dirtyN: 0,
	fullRefill: false,
	W: 0,
	H: 0,
	/**
	 * @param {number} x 列
	 * @param {number} y 行
	 * @returns {void}
	 */
	markDirty(x, y) {
		if (PRESSURE_CTX.fullRefill) return
		if (PRESSURE_CTX.dirtyN >= P_DIRTY_FULL_THRESH) {
			PRESSURE_CTX.fullRefill = true
			return
		}
		let dirtyX = /** @type {Int32Array} */ (PRESSURE_CTX.dirtyX)
		let dirtyY = /** @type {Int32Array} */ (PRESSURE_CTX.dirtyY)
		const world = /** @type {FluidWorld} */ (PRESSURE_CTX.world)
		if (PRESSURE_CTX.dirtyN >= dirtyX.length) {
			dirtyX = growScratch(world, 'liqPDirtyX', PRESSURE_CTX.dirtyN + 1, Int32Array)
			dirtyY = growScratch(world, 'liqPDirtyY', PRESSURE_CTX.dirtyN + 1, Int32Array)
			PRESSURE_CTX.dirtyX = dirtyX
			PRESSURE_CTX.dirtyY = dirtyY
		}
		dirtyX[PRESSURE_CTX.dirtyN] = x
		dirtyY[PRESSURE_CTX.dirtyN] = y
		PRESSURE_CTX.dirtyN++
	},
	/**
	 * @param {number} x 列
	 * @param {number} y 行
	 * @returns {number} 缓存的液/气压力
	 */
	pAt(x, y) {
		if (PRESSURE_CTX.dirtyN || PRESSURE_CTX.fullRefill) flushPressure()
		const { W, H } = PRESSURE_CTX
		if (x < 0 || y < 0 || x >= W || y >= H)
			return pressureAt(/** @type {FluidWorld} */ (PRESSURE_CTX.world), x, Math.max(0, y))
		return /** @type {Float32Array} */ (PRESSURE_CTX.cache)[y * W + x]
	},
}

/**
 * 冲刷脏种子到压力缓存。
 * @returns {void}
 */
const flushPressure = () => {
	const ctx = PRESSURE_CTX
	const world = /** @type {FluidWorld} */ (ctx.world)
	const cache = /** @type {Float32Array} */ (ctx.cache)
	const depth = /** @type {Float32Array} */ (ctx.depth)
	const order = /** @type {Int32Array} */ (ctx.order)
	const upWeights = /** @type {{ dx: number[], dy: number[], w: number[], n: number }} */ (ctx.upWeights)
	if (ctx.fullRefill) {
		fillPressureByDepth(world, cache, depth, order, upWeights, UP_LINE)
		ctx.fullRefill = false
		ctx.dirtyN = 0
		return
	}
	const dirtyX = /** @type {Int32Array} */ (ctx.dirtyX)
	const dirtyY = /** @type {Int32Array} */ (ctx.dirtyY)
	for (let i = 0; i < ctx.dirtyN; i++)
		refreshGravityLine(world, dirtyX[i], dirtyY[i], cache, depth, UP_LINE, DOWN_LINE)
	ctx.dirtyN = 0
}

/**
 * 格对静压柱的有效填充贡献（按密度归一到 RHO_G 压头）。
 * @param {FluidWorld} world 世界
 * @param {number} cell 索引
 * @returns {number} 等效压头填充
 */
const columnFillHead = (world, cell) => {
	const fill = Math.min(1, Math.max(cellFill(world, cell), LIQ_DRAW))
	const rho = cellRho(world, cell)
	return fill * (rho / RHO_G)
}

/**
 * 静压：P_air + RHO_G · (深度差 + 等效填充头)。
 * @param {number} airP 自由面空气压
 * @param {number} depth 当前深度
 * @param {number} surfDepth 自由面深度
 * @param {number} fillHead 等效填充压头
 * @returns {number} 该格静压
 */
const columnDepthPressure = (airP, depth, surfDepth, fillHead) =>
	airP + RHO_G * ((depth - surfDepth) + fillHead)

/**
 * `(x, y)` 处凝聚相静压（水+熔岩柱）。
 * @param {FluidWorld} world 流体世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {number} 静压
 */
export const condensedPressureAt = (world, x, y) => {
	if (!inWorld(world, x, y)) return pressureAt(world, x, Math.max(0, y))
	const cell = idx(world, x, y)
	if (!isCondensed(world, cell) && !isLiquidBarrier(world.mat[cell]))
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
		if (!isCondensed(world, above)) break
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

	// Integrate density-weighted heads from surface down to (x,y).
	let p = airP
	let cx = sx
	let cy = sy
	const down = strongestDown(world)
	const steps = Math.max(world.worldW, world.worldH) + 2
	for (let s = 0; s < steps; s++) {
		const ci = cy * world.worldW + cx
		const head = columnFillHead(world, ci)
		if (s === 0)
			p = columnDepthPressure(airP, gravityDepth(world, cx, cy), gravityDepth(world, sx, sy), head)
		else {
			const prev = (cy - down.dy) * world.worldW + (cx - down.dx)
			const dPrev = gravityDepth(world, cx - down.dx, cy - down.dy)
			const dHere = gravityDepth(world, cx, cy)
			const headPrev = columnFillHead(world, prev)
			p += RHO_G * (dHere - dPrev) + RHO_G * (head - headPrev)
		}
		if (cx === x && cy === y) return p
		if (down.w <= 0) break
		cx += down.dx
		cy += down.dy
		if (!inWorld(world, cx, cy)) break
		if (!isCondensed(world, cy * world.worldW + cx)) break
	}
	return columnDepthPressure(airP, gravityDepth(world, x, y), gravityDepth(world, sx, sy), columnFillHead(world, cell))
}

/**
 * `(x, y)` 处液体静压（兼容别名 → 凝聚柱）。
 * @param {FluidWorld} world 流体世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {number} 静压
 */
export const liquidPressureAt = (world, x, y) => condensedPressureAt(world, x, y)

/**
 * 填充整网凝聚相压力缓存。
 * @param {FluidWorld} world 流体世界
 * @param {Float32Array} cache 压力缓冲
 * @param {Float32Array} depth 每格深度
 * @param {Int32Array} order 浅→深序
 * @param {{ dx: number[], dy: number[], w: number[], n: number }} up 上向权重
 * @param {{ dx: number, dy: number, w: number }} strongUp 最强上向
 * @returns {void}
 */
const fillPressureByDepth = (world, cache, depth, order, up, strongUp) => {
	const { worldW: W, mat } = world
	const n = order.length
	const airEpoch = /** @type {number} */ (world.scratch.airEpoch) | 0
	const thermoP = world.scratch.thermoPEpoch === airEpoch
		? /** @type {Float32Array | undefined} */ (world.scratch.thermoP)
		: undefined

	for (let si = 0; si < n; si++) {
		const cell = order[si]
		const x = cell % W
		const y = (cell / W) | 0
		if (!isCondensed(world, cell) || isLiquidBarrier(mat[cell])) {
			cache[cell] = thermoP ? thermoP[cell] : pressureAt(world, x, y)
			continue
		}

		let bestAbove = -1
		let bestW = -1
		for (let i = 0; i < up.n; i++) {
			const ax = x + up.dx[i]
			const ay = y + up.dy[i]
			if (!inWorld(world, ax, ay)) continue
			const above = ay * W + ax
			if (!isLiquidBarrier(mat[above]) && isCondensed(world, above))
				if (up.w[i] > bestW) {
					bestW = up.w[i]
					bestAbove = above
				}
		}

		const headHere = columnFillHead(world, cell)
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
			cache[cell] = columnDepthPressure(airP, dHere, dHere, headHere)
		}
		else {
			const dAbove = depth[bestAbove]
			const dHere = depth[cell]
			const headAbove = columnFillHead(world, bestAbove)
			cache[cell] = cache[bestAbove] + RHO_G * (dHere - dAbove) + RHO_G * (headHere - headAbove)
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
	const { worldW: W, worldH: H, mat } = world

	let sx = x0
	let sy = y0
	for (;;) {
		if (!inWorld(world, sx, sy)) break
		const cell = sy * W + sx
		if (isLiquidBarrier(mat[cell]) || !isCondensed(world, cell)) break
		if (up.w <= 0) break
		const nx = sx + up.dx
		const ny = sy + up.dy
		if (!inWorld(world, nx, ny)) break
		const above = ny * W + nx
		if (isLiquidBarrier(mat[above]) || !isCondensed(world, above)) break
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
		if (!isCondensed(world, cell0) && !isLiquidBarrier(mat[cell0]))
			cache[cell0] = pressureAt(world, x0, y0)
		else if (!isLiquidBarrier(mat[cell0]))
			cache[cell0] = columnDepthPressure(airP, depth[cell0], surfDepth, columnFillHead(world, cell0))
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
			if (isLiquidBarrier(mat[cell]) || !isCondensed(world, cell)) {
				if (!isCondensed(world, cell) && !isLiquidBarrier(mat[cell]))
					cache[cell] = pressureAt(world, x, y)
				break
			}
			const prevCell = (y - dy) * W + (x - dx)
			const prev = cache[prevCell]
			const headPrev = columnFillHead(world, prevCell)
			const headHere = columnFillHead(world, cell)
			cache[cell] = prev + RHO_G * (depth[cell] - depth[prevCell]) + RHO_G * (headHere - headPrev)
		}
	}
	if (down.w > 0) walk(down.dx, down.dy)
	if (up.w > 0) walk(up.dx, up.dy)
}

/**
 * 构建本 tick 凝聚相静压查询（脏种子惰性刷新）。
 * @param {FluidWorld} world 流体世界
 * @returns {{
 *   pAt: (x: number, y: number) => number,
 *   markDirty: (x: number, y: number) => void,
 *   depth: Float32Array,
 *   deepOrder: Int32Array,
 *   upWeights: { dx: number[], dy: number[], w: number[], n: number },
 *   strongUp: { dx: number, dy: number, w: number },
 *   strongDown: { dx: number, dy: number, w: number },
 * }} 压力 API 与重力快照（复用壳）
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

	const { shallow: order, deep: deepOrder } = buildDepthOrders(
		world, 'liqPFOrder', 'liqDeepOrder', 'liqDepthCounts', depth,
	)
	const cache = scratch(world, 'liqP', n, Float32Array)
	fillPressureByDepth(world, cache, depth, order, upWeights, UP_LINE)

	PRESSURE_CTX.world = world
	PRESSURE_CTX.cache = cache
	PRESSURE_CTX.depth = depth
	PRESSURE_CTX.order = order
	PRESSURE_CTX.deepOrder = deepOrder
	PRESSURE_CTX.upWeights = upWeights
	PRESSURE_CTX.strongUp = strongUp
	PRESSURE_CTX.strongDown = strongDown
	PRESSURE_CTX.dirtyX = growScratch(world, 'liqPDirtyX', 64, Int32Array)
	PRESSURE_CTX.dirtyY = growScratch(world, 'liqPDirtyY', 64, Int32Array)
	PRESSURE_CTX.dirtyN = 0
	PRESSURE_CTX.fullRefill = false
	PRESSURE_CTX.W = W
	PRESSURE_CTX.H = H
	return PRESSURE_CTX
}
