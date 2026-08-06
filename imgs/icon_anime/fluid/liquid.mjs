/**
 * 网格液体：静压驱动全部自由液体质量转移。
 *
 * P = P_air(表面) + RHO_G·深度。孔口/重力/浸没排气口用
 * Torricelli √(ΔP/ρg)。自由面液膜仅均衡填充。连通容器沿液体图松弛
 * φ = P/(ρg)−depth（不瞬移）。P 高于液体的密闭气体阻挡侵入并推开邻液。
 * 熔岩经 `transport.mjs` 共用核。土壤渗流见 `soil.mjs`。
 */

import { ORTHO_DX, ORTHO_DY } from '../hash.mjs'

import {
	pressureMove, sheetMove, applyTransfer, P_FLOW_GAIN,
} from './flow.mjs'
import { equilibrateHydraulic } from './equilibrate.mjs'
import { labelAirRegions, pressureAt, gasUxAt } from './gas.mjs'
import {
	MAT, P_ATM, RHO_G, LIQ_DRAW, LIQ_FULL, isLiquidBarrier, T_AMB,
} from './mat.mjs'
import { stepSoil } from './soil.mjs'
import { meltVisc, cellRho } from './thermal.mjs'
import { neighborCoord } from './edges.mjs'
import {
	stepPhaseTransport, meltCanEnter, meltTempOnTransfer,
} from './transport.mjs'
import {
	scratch, idx, inWorld,
	markAirIfDrawCrossed, markAirIfMeltDrawCrossed,
	gravityDepth, gravityDownWeights, gravityUpWeights,
} from './world.mjs'

/** @typedef {import('./world.mjs').FluidWorld} FluidWorld */

/** 水平风 → 自由面液膜耦合（每单位 gas ux 的格/帧）。 */
const WIND_SHEET = 0.12
/** 每边每帧风驱液膜质量上限。 */
const WIND_SHEET_CAP = 0.18

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

	const up = gravityUpWeights(world)
	let sx = x
	let sy = y
	for (;;) {
		if (up.n <= 0) break
		let best = 0
		for (let i = 1; i < up.n; i++)
			if (up.w[i] > up.w[best]) best = i
		const nx = sx + up.dx[best]
		const ny = sy + up.dy[best]
		if (!inWorld(world, nx, ny)) break
		const above = idx(world, nx, ny)
		if (isLiquidBarrier(world.mat[above])) break
		if (world.liq[above] < LIQ_DRAW) break
		sx = nx
		sy = ny
	}

	const upBest = up.n > 0 ? 0 : -1
	let airX = sx
	let airY = sy
	if (up.n > 0) {
		let best = 0
		for (let i = 1; i < up.n; i++)
			if (up.w[i] > up.w[best]) best = i
		airX = sx + up.dx[best]
		airY = sy + up.dy[best]
		void upBest
	}
	const airP = inWorld(world, airX, airY) && !isLiquidBarrier(world.mat[idx(world, airX, airY)])
		? pressureAt(world, airX, airY)
		: pressureAt(world, sx, sy)
	return columnDepthPressure(airP, gravityDepth(world, x, y), gravityDepth(world, sx, sy), L)
}

/**
 * 按深度桶计数排序，浅→深单遍填充压力缓存。
 * @param {FluidWorld} world 流体世界
 * @param {Float32Array} cache 压力缓冲
 * @returns {void}
 */
const fillPressureByDepth = (world, cache) => {
	const { worldW: W, worldH: H, mat, liq } = world
	const n = W * H
	const order = scratch(world, 'liqDepthOrder', n, Int32Array)
	const depths = scratch(world, 'liqDepthVals', n, Float32Array)
	for (let cell = 0; cell < n; cell++) {
		const x = cell % W
		const y = (cell / W) | 0
		depths[cell] = gravityDepth(world, x, y)
		order[cell] = cell
	}
	// Counting sort by quantized depth buckets (stable enough for hydro).
	const buckets = Math.max(W, H) + 2
	const counts = scratch(world, 'liqDepthCounts', buckets, Int32Array)
	counts.fill(0)
	const span = world.gravityDepthSpan || 1
	for (let cell = 0; cell < n; cell++) {
		const b = Math.min(buckets - 1, Math.max(0, ((depths[cell] / span) * (buckets - 1)) | 0))
		counts[b]++
	}
	let sum = 0
	for (let b = 0; b < buckets; b++) {
		const c = counts[b]
		counts[b] = sum
		sum += c
	}
	const sorted = scratch(world, 'liqDepthSorted', n, Int32Array)
	for (let cell = 0; cell < n; cell++) {
		const b = Math.min(buckets - 1, Math.max(0, ((depths[cell] / span) * (buckets - 1)) | 0))
		sorted[counts[b]++] = cell
	}

	const surfOf = scratch(world, 'liqSurfOf', n, Int32Array)
	const airPOf = scratch(world, 'liqAirPOf', n, Float32Array)
	surfOf.fill(-1)

	for (let i = 0; i < n; i++) {
		const cell = sorted[i]
		const x = cell % W
		const y = (cell / W) | 0
		const L = liq[cell]
		if (L < LIQ_DRAW && !isLiquidBarrier(mat[cell])) {
			cache[cell] = pressureAt(world, x, y)
			continue
		}
		// Find free-surface cell by walking up; cache chain.
		const up = gravityUpWeights(world)
		let sx = x
		let sy = y
		let surfCell = cell
		for (;;) {
			if (up.n <= 0) break
			let best = 0
			for (let k = 1; k < up.n; k++)
				if (up.w[k] > up.w[best]) best = k
			const nx = sx + up.dx[best]
			const ny = sy + up.dy[best]
			if (!inWorld(world, nx, ny)) break
			const above = ny * W + nx
			if (isLiquidBarrier(mat[above])) break
			if (liq[above] < LIQ_DRAW) break
			sx = nx
			sy = ny
			surfCell = above
		}
		let airP
		if (surfOf[surfCell] >= 0)
			airP = airPOf[surfCell]
		else {
			let best = 0
			for (let k = 1; k < up.n; k++)
				if (up.w[k] > up.w[best]) best = k
			const airX = up.n > 0 ? sx + up.dx[best] : sx
			const airY = up.n > 0 ? sy + up.dy[best] : sy
			airP = inWorld(world, airX, airY) && !isLiquidBarrier(mat[airY * W + airX])
				? pressureAt(world, airX, airY)
				: pressureAt(world, sx, sy)
			surfOf[surfCell] = 1
			airPOf[surfCell] = airP
		}
		cache[cell] = columnDepthPressure(airP, depths[cell], depths[surfCell], L)
	}
}

/**
 * 沿 ĝ 的 DDA 重力线刷新压力（增量）。
 * @param {FluidWorld} world 世界
 * @param {number} x0 起点列
 * @param {number} y0 起点行
 * @param {Float32Array} cache 压力缓存
 * @returns {void}
 */
const refreshGravityLine = (world, x0, y0, cache) => {
	const { worldW: W, worldH: H, gravity } = world
	const gx = gravity.gx
	const gy = gravity.gy
	// Walk both ways along ĝ through the grid.
	const steps = Math.max(W, H) * 2
	for (const sense of [1, -1]) {
		let x = x0
		let y = y0
		for (let s = 0; s < steps; s++) {
			x += gx * sense
			y += gy * sense
			const cx = Math.round(x)
			const cy = Math.round(y)
			if (!inWorld(world, cx, cy)) break
			cache[cy * W + cx] = liquidPressureAt(world, cx, cy)
		}
	}
	if (inWorld(world, x0, y0))
		cache[y0 * W + x0] = liquidPressureAt(world, x0, y0)
}

/**
 * 自由面格？（所有上向加权邻格皆非液 / 出界）。
 * @param {FluidWorld} world 流体世界
 * @param {number} cell 扁平索引
 * @param {number} x 列
 * @param {number} y 行
 * @returns {boolean} 液体上方是否为空气
 */
const isFreeSurface = (world, cell, x, y) => {
	const up = gravityUpWeights(world)
	if (up.n <= 0) return true
	for (let i = 0; i < up.n; i++) {
		const ux = x + up.dx[i]
		const uy = y + up.dy[i]
		if (!inWorld(world, ux, uy)) continue
		const above = uy * world.worldW + ux
		if (!isLiquidBarrier(world.mat[above]) && world.liq[above] >= LIQ_DRAW)
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
 * 液体步进：压驱沉降、风驱液膜、土壤、图水力均衡、熔岩输运。
 * @param {FluidWorld} world 流体世界
 */
export const stepLiquid = (world) => {
	const { worldW: W, worldH: H, mat, liq, liqVx, liqVy } = world
	if (world.airDirty) labelAirRegions(world)

	const n = W * H
	const flowX = scratch(world, 'liqFlowX', n, Float32Array)
	const flowY = scratch(world, 'liqFlowY', n, Float32Array)
	flowX.fill(0)
	flowY.fill(0)

	const pCache = scratch(world, 'liqP', n, Float32Array)
	fillPressureByDepth(world, pCache)

	/**
	 * 缓存压力（O(1)）；网格外回退气体静压。
	 * @param {number} x 列
	 * @param {number} y 行
	 * @returns {number} 缓存的液/气压力
	 */
	const pAt = (x, y) => {
		if (x < 0 || y < 0 || x >= W || y >= H) return pressureAt(world, x, Math.max(0, y))
		return pCache[y * W + x]
	}

	const down = gravityDownWeights(world)

	// --- Gravity-weighted settle ---
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (liq[cell] <= 0) continue
			if (isLiquidBarrier(mat[cell])) {
				const before = liq[cell]
				liq[cell] = 0
				markAirIfDrawCrossed(world, before, 0)
				continue
			}
			const pSrc = pAt(x, y)
			let did = false
			let openDown = false
			for (let i = 0; i < down.n; i++) {
				const dx = down.dx[i]
				const dy = down.dy[i]
				const w = down.w[i]
				const nx = x + dx
				const ny = y + dy
				if (!canOccupy(world, nx, ny)) continue
				const below = ny * W + nx
				if (liq[below] >= LIQ_FULL) continue
				openDown = true
				if (poolRetainBlocks(world, cell, below)) continue

				const pDst = pAt(nx, ny)
				const room = LIQ_FULL - liq[below]
				let move = pressureMove(pSrc, pDst, liq[cell] * w, room)
				if (move < 0.01 && liq[below] < liq[cell] && pDst < pSrc + RHO_G * 0.85)
					move = Math.min(liq[cell] * w, room, Math.max(0.08, (liq[cell] - liq[below]) * 0.85 * w))
				if (move > 0) {
					transfer(world, liq, flowX, flowY, cell, below, dx, dy, move)
					refreshGravityLine(world, x, y, pCache)
					refreshGravityLine(world, nx, ny, pCache)
					did = true
				}
			}
			if (did || openDown) continue

			// Diagonal settle only when primary down path is blocked.
			for (let pass = 0; pass < 4; pass++) {
				const dx = ORTHO_DX[pass]
				const dy = ORTHO_DY[pass]
				const along = dx * world.gravity.gx + dy * world.gravity.gy
				if (along <= 0.15) continue
				const nx = x + dx
				const ny = y + dy
				if (!canOccupy(world, nx, ny)) continue
				const neighbor = ny * W + nx
				if (liq[neighbor] >= liq[cell] || poolRetainBlocks(world, cell, neighbor)) continue
				const pN = liquidPressureAt(world, nx, ny)
				let m = pressureMove(pSrc, pN, liq[cell] * 0.5, LIQ_FULL - liq[neighbor])
				if (m <= 0.01)
					m = Math.min(liq[cell] * 0.5, (liq[cell] - liq[neighbor]) * 0.5, LIQ_FULL - liq[neighbor])
				if (m <= 0.01) continue
				transfer(world, liq, flowX, flowY, cell, neighbor, dx, dy, m)
				refreshGravityLine(world, x, y, pCache)
				refreshGravityLine(world, nx, ny, pCache)
				break
			}
		}

	// --- Lateral: free-surface sheet / submerged orifice / edge vent / wind ---
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (liq[cell] <= 0.05 || isLiquidBarrier(mat[cell])) continue
			const pSrc = pAt(x, y)
			const freeSurface = isFreeSurface(world, cell, x, y)

			for (let pass = 0; pass < 4; pass++) {
				const dx = ORTHO_DX[pass]
				const dy = ORTHO_DY[pass]
				// Prefer directions perpendicular to gravity for sheet.
				const along = Math.abs(dx * world.gravity.gx + dy * world.gravity.gy)
				if (along > 0.7) continue
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
								? sheetMove(liq[cell], liq[neighbor], room)
								: pressureMove(pSrc, pDst, liq[cell], room)
							move *= nb.wrappedFrac
							if (move > 0) {
								transfer(world, liq, flowX, flowY, cell, neighbor, dx, dy, move)
								refreshGravityLine(world, x, y, pCache)
								refreshGravityLine(world, nb.x, nb.y, pCache)
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
						refreshGravityLine(world, x, y, pCache)
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
					move = sheetMove(liq[cell], liq[neighbor], room)
				else {
					if (pDst >= pSrc - 0.02 && liq[neighbor] >= liq[cell] - 0.02) continue
					move = pressureMove(pSrc, pDst, liq[cell], room)
					if (move < 0.01 && liq[neighbor] < liq[cell] - 0.02)
						move = Math.min((liq[cell] - liq[neighbor]) * 0.25, room)
				}

				if (freeSurface && liq[cell] >= LIQ_DRAW) {
					const gux = gasUxAt(world, x, y)
					const guy = world.gasUy[idx(world, x, Math.max(0, y - 1 < 0 ? y : y))]
					// Sample gas above along −ĝ for wind shear.
					const up = gravityUpWeights(world)
					let ux = gux
					let uy = guy
					if (up.n > 0) {
						let best = 0
						for (let k = 1; k < up.n; k++)
							if (up.w[k] > up.w[best]) best = k
						const ax = x + up.dx[best]
						const ay = y + up.dy[best]
						if (inWorld(world, ax, ay)) {
							ux = world.gasUx[ay * W + ax]
							uy = world.gasUy[ay * W + ax]
						}
					}
					const windAlong = ux * dx + uy * dy
					if (windAlong > 0.15) {
						const wind = Math.min(WIND_SHEET_CAP, windAlong * WIND_SHEET, liq[cell] * 0.2, room)
						move = Math.max(move, wind)
					}
				}

				if (move > 0) {
					transfer(world, liq, flowX, flowY, cell, neighbor, dx, dy, move)
					refreshGravityLine(world, x, y, pCache)
					refreshGravityLine(world, nx, ny, pCache)
				}
			}
		}

	// --- Sealed gas pushes adjacent free liquid away ---
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
				if (canOccupy(world, tx, ty) && liq[idx(world, tx, ty)] < LIQ_FULL) {
					const target = idx(world, tx, ty)
					transfer(world, liq, flowX, flowY, neighbor, target, tx - nx, ty - ny, push)
				}
				else if (down.n > 0) {
					let best = 0
					for (let k = 1; k < down.n; k++)
						if (down.w[k] > down.w[best]) best = k
					const bx = nx + down.dx[best]
					const by = ny + down.dy[best]
					if (canOccupy(world, bx, by)) {
						const target = idx(world, bx, by)
						transfer(world, liq, flowX, flowY, neighbor, target, down.dx[best], down.dy[best], push)
					}
				}
			}
		}

	stepSoil(world)
	equilibrateHydraulic(world, flowX, flowY, 1)
	stepMelt(world)
	stepBuoyancy(world)

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

/**
 * 熔岩输运（共用凝聚相核）。
 * @param {FluidWorld} world 世界
 * @returns {void}
 */
const stepMelt = (world) => {
	stepPhaseTransport(world, {
		mass: world.melt,
		vx: world.meltVx,
		vy: world.meltVy,
		viscAt: meltVisc,
		canEnter: meltCanEnter,
		onTransfer: meltTempOnTransfer,
		markDirty: markAirIfMeltDrawCrossed,
		flowScratchX: 'meltFlowX',
		flowScratchY: 'meltFlowY',
	})
}

/**
 * 沿重力：下方更轻则与上方交换（对流 / 气泡）。
 * @param {FluidWorld} world 世界
 * @returns {void}
 */
const stepBuoyancy = (world) => {
	const { worldW: W, worldH: H, melt, liq, temp, mat } = world
	const down = gravityDownWeights(world)
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			for (let i = 0; i < down.n; i++) {
				if (down.w[i] < 0.5) continue
				const belowX = x + down.dx[i]
				const belowY = y + down.dy[i]
				if (!inWorld(world, belowX, belowY)) continue
				const a = y * W + x
				const b = belowY * W + belowX
				if (isLiquidBarrier(mat[a]) || isLiquidBarrier(mat[b])) continue
				const rhoA = cellRho(world, a)
				const rhoB = cellRho(world, b)
				if (rhoB + 0.04 >= rhoA) continue
				if (melt[a] < 0.05 && melt[b] < 0.05 && liq[a] < 0.05 && liq[b] < 0.05) continue
				const ma = melt[a]
				const mb = melt[b]
				const ta = temp[a]
				const tb = temp[b]
				const la = liq[a]
				const lb = liq[b]
				melt[a] = mb
				melt[b] = ma
				temp[a] = tb
				temp[b] = ta
				liq[a] = lb
				liq[b] = la
				markAirIfMeltDrawCrossed(world, ma, melt[a])
				markAirIfMeltDrawCrossed(world, mb, melt[b])
				markAirIfDrawCrossed(world, la, liq[a])
				markAirIfDrawCrossed(world, lb, liq[b])
			}
		}
}

// silence unused T_AMB if melt hook handles it
void T_AMB
