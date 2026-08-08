/**
 * 自由水相：静压柱、重力沉降、侧向液膜、风驱与密闭气体推挤。
 *
 * P = P_air(表面) + RHO_G·深度。孔口/重力用 Torricelli √(ΔP/ρg)。
 * 自由面液膜仅均衡填充。密闭超压气体阻挡侵入并可推开邻液。
 */

import { ORTHO_DX, ORTHO_DY } from '../../hash.mjs'
import { neighborCoord } from '../edges.mjs'
import {
	pressureMove, sheetMove, applyTransfer, P_FLOW_GAIN,
} from '../flow.mjs'
import { labelAirRegions, pressureAt, gasUxAt } from '../gas.mjs'
import {
	MAT, P_ATM, RHO_G, LIQ_DRAW, LIQ_FULL, ST_DRY_FRAC, isLiquidBarrier,
	SUBSTANCE, rhoOf, viscOf,
} from '../mat.mjs'
import {
	scratch, growScratch, idx, inWorld,
	markAirIfDrawCrossed,
	gravityDepth, gravityUpWeights, gravitySettleWeights, gravitySideWeights,
	strongestUp, strongestDown, fillCellDepths, buildDepthOrder,
} from '../world.mjs'

/** @typedef {import('../world.mjs').FluidWorld} FluidWorld */

/** 水平风 → 自由面液膜耦合（每单位 gas ux 的格/帧）。 */
const WIND_SHEET = 0.12
/** 每边每帧风驱液膜质量上限。 */
const WIND_SHEET_CAP = 0.18
/** 水相粘滞（viscOf(rhoOf(WATER))）。 */
export const WATER_VISC = viscOf(rhoOf(SUBSTANCE.WATER, 0))
/** 脏压强种子过多时直接全网重填。 */
const P_DIRTY_FULL_THRESH = 48

/**
 * 自由液体能否进入 `(x, y)`。
 * @param {FluidWorld} world 流体世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {boolean} 该格是否可接纳液体
 */
const canOccupy = (world, x, y) => {
	if (x < 0 || y < 0 || x >= world.worldW || y >= world.worldH) return false
	const cell = y * world.worldW + x
	const m = world.mat[cell]
	if (isLiquidBarrier(m)) return false
	if (m === MAT.POOL) return world.liq[cell] < LIQ_FULL
	return true
}

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
 * 自由面格？（所有上向加权邻格皆非液 / 出界）。
 * @param {FluidWorld} world 流体世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {{ dx: number[], dy: number[], w: number[], n: number }} up 上向权重
 * @returns {boolean} 液体上方是否为空气
 */
const isFreeSurface = (world, x, y, up) => {
	if (up.n <= 0) return true
	const { mat, liq, worldW: W } = world
	for (let i = 0; i < up.n; i++) {
		const ux = x + up.dx[i]
		const uy = y + up.dy[i]
		if (!inWorld(world, ux, uy)) continue
		const above = uy * W + ux
		if (!isLiquidBarrier(mat[above]) && liq[above] >= LIQ_DRAW)
			return false
	}
	return true
}

/**
 * POOL 保留：近满前不泄，除非流入另一 POOL。
 * @param {FluidWorld} world 流体世界
 * @param {number} src 源索引
 * @param {number} dst 目标索引
 * @returns {boolean} 是否应阻止转移
 */
const poolRetainBlocks = (world, src, dst) =>
	world.mat[src] === MAT.POOL && world.mat[dst] !== MAT.POOL && world.liq[src] < 0.92

/**
 * 空气邻格的密闭超压阻挡侵入。
 * @param {FluidWorld} world 流体世界
 * @param {number} neighbor 目标索引
 * @param {number} pSrc 源处液体压力
 * @returns {boolean} 密闭气体是否阻挡移动
 */
const sealedGasBlocks = (world, neighbor, pSrc) => {
	if (world.liq[neighbor] > 0.05) return false
	const rid = world.regionId[neighbor]
	if (!rid) return false
	const region = world.regions[rid]
	return !!(region && !region.openToAtm && region.pressure > pSrc + 0.05)
}

/**
 * 转移质量；格越过自由液体绘制阈值时标脏空气。
 * @param {FluidWorld} world 流体世界
 * @param {Float32Array} liq 液体场
 * @param {Float32Array} flowX 水平流
 * @param {Float32Array} flowY 垂直流
 * @param {number} src 源索引
 * @param {number} dst 目标索引
 * @param {number} dx 水平步
 * @param {number} dy 垂直步
 * @param {number} move 质量
 * @returns {number} 已移质量
 */
const transfer = (world, liq, flowX, flowY, src, dst, dx, dy, move) => {
	const a0 = liq[src]
	const b0 = liq[dst]
	const m = applyTransfer(liq, flowX, flowY, src, dst, dx, dy, move)
	if (m > 0) {
		markAirIfDrawCrossed(world, a0, liq[src])
		markAirIfDrawCrossed(world, b0, liq[dst])
	}
	return m
}

/**
 * 水相质量输运（沉降 / 侧膜 / 风 / 气体推挤）。
 * 流场写入 `liqFlowX` / `liqFlowY` scratch，供后续水力均衡与速度合成。
 * @param {FluidWorld} world 流体世界
 * @returns {{ flowX: Float32Array, flowY: Float32Array }} 本 tick 水流缓冲
 */
export const stepWater = (world) => {
	const { worldW: W, worldH: H, mat, liq } = world
	if (world.airDirty) labelAirRegions(world)

	const n = W * H
	const flowX = scratch(world, 'liqFlowX', n, Float32Array)
	const flowY = scratch(world, 'liqFlowY', n, Float32Array)
	flowX.fill(0)
	flowY.fill(0)

	const depth = fillCellDepths(world)
	const upW = gravityUpWeights(world)
	const strongUp = strongestUp(world)
	const strongUpDx = strongUp.dx
	const strongUpDy = strongUp.dy
	const strongUpW = strongUp.w
	const strongDown = strongestDown(world)
	const strongDownDx = strongDown.dx
	const strongDownDy = strongDown.dy
	const strongDownW = strongDown.w
	const upStrong = { dx: strongUpDx, dy: strongUpDy, w: strongUpW }
	const downStrong = { dx: strongDownDx, dy: strongDownDy, w: strongDownW }

	const pfOrder = buildDepthOrder(world, 'liqPFOrder', 'liqPFCounts', false, depth)
	const pCache = scratch(world, 'liqP', n, Float32Array)
	fillPressureByDepth(world, pCache, depth, pfOrder, upW, upStrong)

	let dirtyX = growScratch(world, 'liqPDirtyX', 64, Int32Array)
	let dirtyY = growScratch(world, 'liqPDirtyY', 64, Int32Array)
	let dirtyN = 0
	let fullRefill = false

	/**
	 * 标记压强脏种子（读前惰性刷新，合并同批转移）。
	 * @param {number} x 列
	 * @param {number} y 行
	 * @returns {void}
	 */
	const markPDirty = (x, y) => {
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
	 * 冲刷脏压强：种子少走 DDA，多则全网重填。
	 * @returns {void}
	 */
	const flushP = () => {
		if (fullRefill) {
			fillPressureByDepth(world, pCache, depth, pfOrder, upW, upStrong)
			fullRefill = false
			dirtyN = 0
			return
		}
		for (let i = 0; i < dirtyN; i++)
			refreshGravityLine(world, dirtyX[i], dirtyY[i], pCache, depth, upStrong, downStrong)
		dirtyN = 0
	}

	/**
	 * 缓存压力（O(1)）；网格外回退气体静压。读前冲刷脏种子。
	 * @param {number} x 列
	 * @param {number} y 行
	 * @returns {number} 缓存的液/气压力
	 */
	const pAt = (x, y) => {
		if (dirtyN || fullRefill) flushP()
		if (x < 0 || y < 0 || x >= W || y >= H) return pressureAt(world, x, Math.max(0, y))
		return pCache[y * W + x]
	}

	const downW = gravitySettleWeights(world)
	const sides = gravitySideWeights(world)
	const order = buildDepthOrder(world, 'liqSettleOrder', 'liqSettleCounts', true, depth)

	for (let si = 0; si < n; si++) {
		const cell = order[si]
		const x = cell % W
		const y = (cell / W) | 0
		if (liq[cell] <= 0) continue
		if (isLiquidBarrier(mat[cell])) {
			const before = liq[cell]
			liq[cell] = 0
			markAirIfDrawCrossed(world, before, 0)
			continue
		}
		const pSrc = pAt(x, y)
		let did = false
		for (let di = 0; di < downW.n; di++) {
			const ddx = downW.dx[di]
			const ddy = downW.dy[di]
			const w = downW.w[di]
			const nx = x + ddx
			const ny = y + ddy
			if (!canOccupy(world, nx, ny)) continue
			const below = ny * W + nx
			if (liq[below] >= LIQ_FULL || poolRetainBlocks(world, cell, below)) continue
			const pDst = pAt(nx, ny)
			const room = LIQ_FULL - liq[below]
			let move = pressureMove(pSrc, pDst, liq[cell] * w, room, WATER_VISC)
			if (move < 0.01 && liq[below] < liq[cell] && pDst < pSrc + RHO_G * 0.85)
				move = Math.min(liq[cell] * w, room, Math.max(0.08, (liq[cell] - liq[below]) * 0.85 * w))
			if (move <= 0) continue
			transfer(world, liq, flowX, flowY, cell, below, ddx, ddy, move)
			markPDirty(x, y)
			did = true
			if (liq[cell] <= 0.02) break
		}
		if (did) continue

		// Blocked below: diagonal crawl along strongest down × side (stair-step).
		if (strongDownW <= 0) continue
		const dir = (x + y) & 1 ? 1 : -1
		const crawl0dx = strongDownDx === 0 ? dir : strongDownDx
		const crawl0dy = strongDownDx === 0 ? strongDownDy : dir
		const crawl1dx = strongDownDx === 0 ? -dir : strongDownDx
		const crawl1dy = strongDownDx === 0 ? strongDownDy : -dir
		for (let ci = 0; ci < 2; ci++) {
			const dx = ci === 0 ? crawl0dx : crawl1dx
			const dy = ci === 0 ? crawl0dy : crawl1dy
			const sx = x + dx
			const sy = y + dy
			if (!canOccupy(world, sx, sy)) continue
			const neighbor = sy * W + sx
			if (liq[neighbor] >= liq[cell] || poolRetainBlocks(world, cell, neighbor)) continue
			const pN = pAt(sx, sy)
			let m = pressureMove(pSrc, pN, liq[cell] * 0.5, LIQ_FULL - liq[neighbor], WATER_VISC)
			if (m <= 0.01)
				m = Math.min(liq[cell] * 0.5, (liq[cell] - liq[neighbor]) * 0.5, LIQ_FULL - liq[neighbor])
			if (m <= 0.01) continue
			transfer(world, liq, flowX, flowY, cell, neighbor, dx, dy, m)
			markPDirty(x, y)
			markPDirty(sx, sy)
			break
		}
	}

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (liq[cell] <= 0.05 || isLiquidBarrier(mat[cell])) continue
			const pSrc = pAt(x, y)
			const freeSurface = isFreeSurface(world, x, y, upW)

			for (let s = 0; s < sides.n; s++) {
				const dx = sides.dx[s]
				const dy = sides.dy[s]
				const nx = x + dx
				const ny = y + dy
				if (nx < 0 || nx >= W || ny < 0 || ny >= H) {
					const nb = neighborCoord(world, x, y, dx, dy)
					if (nb.wrapped && nb.wrappedFrac > 0.5) {
						const neighbor = nb.y * W + nb.x
						if (!isLiquidBarrier(mat[neighbor])) {
							const pDst = pAt(nb.x, nb.y)
							const room = LIQ_FULL - liq[neighbor]
							let move = freeSurface && liq[neighbor] < LIQ_DRAW
								? sheetMove(liq[cell], liq[neighbor], room, WATER_VISC) * ST_DRY_FRAC
								: pressureMove(pSrc, pDst, liq[cell], room, WATER_VISC)
							move *= nb.wrappedFrac
							if (move > 0) {
								transfer(world, liq, flowX, flowY, cell, neighbor, dx, dy, move)
								markPDirty(x, y)
							}
						}
					}
					else {
						const before = liq[cell]
						const outFrac = nb.outFrac || 1
						const move = (freeSurface
							? before * 0.25
							: Math.min(
								before,
								Math.max(before * 0.2, Math.sqrt(Math.max(0, (pSrc - pressureAt(world, x, y)) / RHO_G)) * P_FLOW_GAIN),
							)) * outFrac
						liq[cell] -= move
						flowX[cell] += dx * move
						flowY[cell] += dy * move
						markAirIfDrawCrossed(world, before, liq[cell])
					}
					continue
				}
				const neighbor = ny * W + nx
				if (isLiquidBarrier(mat[neighbor])) continue
				if (poolRetainBlocks(world, cell, neighbor) && mat[neighbor] === MAT.AIR) continue
				if (sealedGasBlocks(world, neighbor, pSrc)) continue

				const pDst = pAt(nx, ny)
				const room = LIQ_FULL - liq[neighbor]
				let move = 0
				if (freeSurface && liq[neighbor] < LIQ_DRAW)
					move = sheetMove(liq[cell], liq[neighbor], room, WATER_VISC) * ST_DRY_FRAC
				else {
					if (pDst >= pSrc - 0.02 && liq[neighbor] >= liq[cell] - 0.02) continue
					move = pressureMove(pSrc, pDst, liq[cell], room, WATER_VISC)
					if (move < 0.01 && liq[neighbor] < liq[cell] - 0.02)
						move = Math.min((liq[cell] - liq[neighbor]) * 0.25, room)
				}

				if (freeSurface && liq[cell] >= LIQ_DRAW) {
					let ux = 0
					let uy = 0
					if (strongUpW > 0) {
						const ax = x + strongUpDx
						const ay = y + strongUpDy
						if (inWorld(world, ax, ay)) {
							ux = world.gasUx[ay * W + ax]
							uy = world.gasUy[ay * W + ax]
						}
					}
					else
						ux = gasUxAt(world, x, y)

					const windAlong = ux * dx + uy * dy
					if (windAlong > 0.15) {
						const wind = Math.min(WIND_SHEET_CAP, windAlong * WIND_SHEET, liq[cell] * 0.2, room)
						move = Math.max(move, wind)
					}
				}

				if (move > 0) {
					transfer(world, liq, flowX, flowY, cell, neighbor, dx, dy, move)
					markPDirty(x, y)
					markPDirty(nx, ny)
				}
			}
		}

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			const rid = world.regionId[cell]
			if (!rid || liq[cell] >= LIQ_DRAW) continue
			const region = world.regions[rid]
			if (!region || region.openToAtm || region.pressure <= P_ATM * 1.2) continue
			const gasP = region.pressure
			for (let o = 0; o < 4; o++) {
				const dx = ORTHO_DX[o]
				const dy = ORTHO_DY[o]
				const nx = x + dx
				const ny = y + dy
				if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
				const neighbor = ny * W + nx
				if (liq[neighbor] < LIQ_DRAW || isLiquidBarrier(mat[neighbor])) continue
				const lP = pAt(nx, ny)
				if (gasP <= lP + 0.08) continue
				const push = Math.min(0.2, liq[neighbor] * 0.35, (gasP - lP) * 0.15)
				if (push < 0.02) continue
				const tx = nx + dx
				const ty = ny + dy
				const target = idx(world, tx, ty)
				if (canOccupy(world, tx, ty) && liq[target] < LIQ_FULL)
					transfer(world, liq, flowX, flowY, neighbor, target, tx - nx, ty - ny, push)
				else if (strongDownW > 0) {
					const bx = nx + strongDownDx
					const by = ny + strongDownDy
					if (canOccupy(world, bx, by)) {
						const below = idx(world, bx, by)
						transfer(world, liq, flowX, flowY, neighbor, below, strongDownDx, strongDownDy, push)
					}
				}
			}
		}

	return { flowX, flowY }
}

/**
 * 由本 tick 水流缓冲合成自由水速度场。
 * @param {FluidWorld} world 流体世界
 * @param {Float32Array} flowX 水平流
 * @param {Float32Array} flowY 垂直流
 * @returns {void}
 */
export const commitWaterVelocity = (world, flowX, flowY) => {
	const { liq, liqVx, liqVy } = world
	const n = liq.length
	for (let i = 0; i < n; i++) {
		const m = liq[i]
		if (m < 1e-6) {
			liqVx[i] = 0
			liqVy[i] = 0
		}
		else {
			liqVx[i] = liqVx[i] * 0.35 + (flowX[i] / m) * 0.65
			liqVy[i] = liqVy[i] * 0.35 + (flowY[i] / m) * 0.65
		}
	}
}
