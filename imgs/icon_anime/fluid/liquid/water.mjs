/**
 * 自由水相：静压驱动沉降、侧向液膜、风驱与密闭气体推挤。
 *
 * 静压柱见 `pressure.mjs`。熔岩等粘滞 Stokes 相走 `transport.mjs`；
 * 水相因静压柱 / POOL 保留 / 密闭气推挤，保留本文件特化。
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
	scratch, idx, inWorld,
	markAirIfDrawCrossed,
	gravitySettleWeights, gravitySideWeights,
	buildDepthOrder,
} from '../world.mjs'

import { beginLiquidPressure } from './pressure.mjs'

/** @typedef {import('../world.mjs').FluidWorld} FluidWorld */

/** 水平风 → 自由面液膜耦合（每单位 gas ux 的格/帧）。 */
const WIND_SHEET = 0.12
/** 每边每帧风驱液膜质量上限。 */
const WIND_SHEET_CAP = 0.18
/** 水相粘滞（viscOf(rhoOf(WATER))）。 */
export const WATER_VISC = viscOf(rhoOf(SUBSTANCE.WATER, 0))

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

/** 复用的水流返回壳（缓冲本身在 world.scratch）。 */
const WATER_FLOW = {
	/** @type {Float32Array | null} */
	flowX: null,
	/** @type {Float32Array | null} */
	flowY: null,
}

/**
 * 水相质量输运（沉降 / 侧膜 / 风 / 气体推挤）。
 * 流场写入 `liqFlowX` / `liqFlowY` scratch，供后续水力均衡与速度合成。
 * @param {FluidWorld} world 流体世界
 * @returns {{ flowX: Float32Array, flowY: Float32Array }} 本 tick 水流缓冲（复用壳）
 */
export const stepWater = (world) => {
	const { worldW: W, worldH: H, mat, liq } = world
	if (world.airDirty) labelAirRegions(world)

	const n = W * H
	const flowX = scratch(world, 'liqFlowX', n, Float32Array)
	const flowY = scratch(world, 'liqFlowY', n, Float32Array)
	flowX.fill(0)
	flowY.fill(0)

	const { pAt, markDirty, depth, upWeights, strongUp, strongDown } = beginLiquidPressure(world)
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
			markDirty(x, y)
			did = true
			if (liq[cell] <= 0.02) break
		}
		if (did) continue

		// Blocked below: diagonal crawl along strongest down × side (stair-step).
		if (strongDown.w <= 0) continue
		const dir = (x + y) & 1 ? 1 : -1
		const crawl0dx = strongDown.dx === 0 ? dir : strongDown.dx
		const crawl0dy = strongDown.dx === 0 ? strongDown.dy : dir
		const crawl1dx = strongDown.dx === 0 ? -dir : strongDown.dx
		const crawl1dy = strongDown.dx === 0 ? strongDown.dy : -dir
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
			markDirty(x, y)
			markDirty(sx, sy)
			break
		}
	}

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (liq[cell] <= 0.05 || isLiquidBarrier(mat[cell])) continue
			const pSrc = pAt(x, y)
			const freeSurface = isFreeSurface(world, x, y, upWeights)

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
								markDirty(x, y)
							}
						}
					}
					else {
						const before = liq[cell]
						const move = (freeSurface
							? before * 0.25
							: Math.min(
								before,
								Math.max(before * 0.2, Math.sqrt(Math.max(0, (pSrc - pressureAt(world, x, y)) / RHO_G)) * P_FLOW_GAIN),
							)) * (nb.outFrac || 1)
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
					if (strongUp.w > 0) {
						const ax = x + strongUp.dx
						const ay = y + strongUp.dy
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
					markDirty(x, y)
					markDirty(nx, ny)
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
				else if (strongDown.w > 0) {
					const bx = nx + strongDown.dx
					const by = ny + strongDown.dy
					if (canOccupy(world, bx, by)) {
						const below = idx(world, bx, by)
						transfer(world, liq, flowX, flowY, neighbor, below, strongDown.dx, strongDown.dy, push)
					}
				}
			}
		}

	WATER_FLOW.flowX = flowX
	WATER_FLOW.flowY = flowY
	return WATER_FLOW
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
