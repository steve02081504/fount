/**
 * 网格液体：静压驱动全部自由液体质量转移。
 *
 * P = P_air(表面) + RHO_G·深度。孔口/重力/浸没排气口用
 * Torricelli √(ΔP/ρg)。自由面液膜仅均衡填充。连通容器沿液体图松弛
 * φ = P/(ρg)−y（不瞬移）。P 高于液体的密闭气体阻挡侵入并推开邻液。
 * 自由面受风切变液膜。土壤渗流见 `soil.mjs`（本文件末尾调用）。
 */

import { ORTHO_DX, ORTHO_DY } from '../hash.mjs'

import {
	pressureMove, sheetMove, applyTransfer, hydraulicPhi, P_FLOW_GAIN,
} from './flow.mjs'
import { labelAirRegions, pressureAt, gasUxAt } from './gas.mjs'
import {
	MAT, P_ATM, RHO_G, LIQ_DRAW, LIQ_FULL, isLiquidBarrier, T_AMB,
} from './mat.mjs'
import { stepSoil } from './soil.mjs'
import { meltVisc, cellRho } from './thermal.mjs'
import { neighborCoord } from './edges.mjs'
import {
	scratch, growScratch, idx, inWorld,
	floodClear, floodPush, markAirIfDrawCrossed, markAirIfMeltDrawCrossed,
	gravityDepth, gravityDownStep,
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
 * `liquidPressureAt` 与列压缓存共用。
 * @param {number} airP 自由面行的空气压
 * @param {number} y 当前行
 * @param {number} surf 自由面行
 * @param {number} amount 格内液体填充
 * @returns {number} 该格静压
 */
const columnDepthPressure = (airP, y, surf, amount) =>
	airP + RHO_G * ((y - surf) + Math.min(1, Math.max(amount, LIQ_DRAW)))

/**
 * `(x, y)` 处液体静压。
 * 空气/干格 → 气体 `pressureAt`。湿格 → P_air(自由面) + RHO_G·深度。
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

	const { dx: ddx, dy: ddy } = gravityDownStep(world)
	const upDx = -ddx
	const upDy = -ddy
	let sx = x
	let sy = y
	for (;;) {
		const nx = sx + upDx
		const ny = sy + upDy
		if (!inWorld(world, nx, ny)) break
		const above = idx(world, nx, ny)
		if (isLiquidBarrier(world.mat[above])) break
		if (world.liq[above] < LIQ_DRAW) break
		sx = nx
		sy = ny
	}

	const airX = sx + upDx
	const airY = sy + upDy
	const airP = inWorld(world, airX, airY) && !isLiquidBarrier(world.mat[idx(world, airX, airY)])
		? pressureAt(world, airX, airY)
		: pressureAt(world, sx, sy)
	return columnDepthPressure(airP, gravityDepth(world, x, y), gravityDepth(world, sx, sy), L)
}

/**
 * 填充单列压力缓存（与 `liquidPressureAt` 一致）。
 * @param {FluidWorld} world 流体世界
 * @param {number} x 列
 * @param {Float32Array} cache 压力缓冲
 */
const fillColumnPressure = (world, x, cache) => {
	const { worldW: W, worldH: H, mat, liq } = world
	const { axis, sign } = world.gravity
	if (axis === 1 && sign === 1) {
		let y = 0
		while (y < H) {
			const cell = y * W + x
			const L = liq[cell]
			if (L < LIQ_DRAW && !isLiquidBarrier(mat[cell])) {
				cache[cell] = pressureAt(world, x, y)
				y++
				continue
			}
			const surf = y
			const airY = surf > 0 && !isLiquidBarrier(mat[(surf - 1) * W + x]) ? surf - 1 : surf
			const airP = pressureAt(world, x, airY)
			while (y < H) {
				const ci = y * W + x
				const Li = liq[ci]
				if (Li < LIQ_DRAW && !isLiquidBarrier(mat[ci])) break
				cache[ci] = columnDepthPressure(airP, y, surf, Li)
				y++
			}
		}
		return
	}
	// Non-default gravity: fill whole grid lazily via liquidPressureAt for this column/row.
	if (axis === 1) {
		for (let y = 0; y < H; y++)
			cache[y * W + x] = liquidPressureAt(world, x, y)
		return
	}
	for (let y = 0; y < H; y++)
		cache[y * W + x] = liquidPressureAt(world, x, y)
}

/**
 * 自由面格？（上方为空气/阻挡，或世界顶）。
 * @param {FluidWorld} world 流体世界
 * @param {number} cell 扁平索引
 * @param {number} y 行
 * @returns {boolean} 液体上方是否为空气
 */
const isFreeSurface = (world, cell, x, y) => {
	const { dx, dy } = gravityDownStep(world)
	const ux = x - dx
	const uy = y - dy
	if (!inWorld(world, ux, uy)) return true
	const above = uy * world.worldW + ux
	return isLiquidBarrier(world.mat[above]) || world.liq[above] < LIQ_DRAW
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
 * 将一自由面样本压入复用 SoA 暂存（分量保持连续）。
 * @param {FluidWorld} world 流体世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} component 连通分量 id
 * @param {number} pressure 面上方空气压
 * @param {{
 *   x: Int32Array, y: Int32Array, c: Int32Array, p: Float32Array, n: number,
 * }} surf 自由面 SoA
 */
const pushSurface = (world, x, y, component, pressure, surf) => {
	const n = surf.n
	if (n >= surf.x.length) {
		surf.x = growScratch(world, 'liqSurfX', n + 1, Int32Array)
		surf.y = growScratch(world, 'liqSurfY', n + 1, Int32Array)
		surf.c = growScratch(world, 'liqSurfC', n + 1, Int32Array)
		surf.p = growScratch(world, 'liqSurfP', n + 1, Float32Array)
	}
	surf.x[n] = x
	surf.y[n] = y
	surf.c[n] = component
	surf.p[n] = pressure
	surf.n = n + 1
}

/**
 * 标注连通液体分量；自由面存为 SoA（按分量分组）。
 * @param {FluidWorld} world 流体世界
 * @returns {{
 *   surf: { x: Int32Array, y: Int32Array, c: Int32Array, p: Float32Array, n: number },
 *   componentOf: Int32Array,
 * }} 自由面样本与每格分量 id
 */
const labelLiquidComponents = (world) => {
	const { worldW: W, worldH: H, mat, liq } = world
	const n = W * H
	const componentOf = scratch(world, 'liqComp', n, Int32Array)
	componentOf.fill(0)
	const surf = {
		x: growScratch(world, 'liqSurfX', 64, Int32Array),
		y: growScratch(world, 'liqSurfY', 64, Int32Array),
		c: growScratch(world, 'liqSurfC', 64, Int32Array),
		p: growScratch(world, 'liqSurfP', 64, Float32Array),
		n: 0,
	}
	let next = 1

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (componentOf[cell] || liq[cell] < LIQ_DRAW || isLiquidBarrier(mat[cell])) continue
			const id = next++
			floodClear(world)
			floodPush(world, x, y)
			componentOf[cell] = id
			for (let qi = 0; qi < world.floodQ.length; qi += 2) {
				const cx = world.floodQ[qi]
				const cy = world.floodQ[qi + 1]
				const aboveY = cy - 1
				if (aboveY < 0)
					pushSurface(world, cx, cy, id, pressureAt(world, cx, 0), surf)
				else {
					const above = aboveY * W + cx
					if (!isLiquidBarrier(mat[above]) && liq[above] < LIQ_DRAW)
						pushSurface(world, cx, cy, id, pressureAt(world, cx, aboveY), surf)
				}
				for (let o = 0; o < 4; o++) {
					const nx = cx + ORTHO_DX[o]
					const ny = cy + ORTHO_DY[o]
					if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
					const neighbor = ny * W + nx
					if (componentOf[neighbor] || liq[neighbor] < LIQ_DRAW || isLiquidBarrier(mat[neighbor])) continue
					componentOf[neighbor] = id
					floodPush(world, nx, ny)
				}
			}
		}

	return { surf, componentOf }
}

/**
 * 沿液体图的路径尊重水力均衡：从最低 φ 自由面 BFS，
 * 格向更接近汇点的邻格推细流。
 * 自由面为 SoA；BFS 用代次戳（无需整网 `dist.fill`）。
 * @param {FluidWorld} world 流体世界
 * @param {Float32Array} flowX 流累加器
 * @param {Float32Array} flowY 流累加器
 */
const equalizeHydraulicAlongGraph = (world, flowX, flowY) => {
	const { surf, componentOf } = labelLiquidComponents(world)
	const { worldW: W, worldH: H, liq } = world
	const n = W * H
	const dist = scratch(world, 'liqHydroDist', n, Int32Array)
	const visit = scratch(world, 'liqHydroVisit', n, Int32Array)
	let gen = (/** @type {number} */ world.scratch.liqHydroGen | 0) + 1
	if (gen >= 0x7fffffff) {
		visit.fill(0)
		gen = 1
	}
	world.scratch.liqHydroGen = gen

	const { x: sx, y: sy, c: sc, p: sp, n: surfN } = surf
	let i = 0
	while (i < surfN) {
		const comp = sc[i]
		const start = i
		while (i < surfN && sc[i] === comp) i++
		const end = i
		if (end - start < 2) continue

		let sink = start
		let sinkPhi = hydraulicPhi(sp[start], gravityDepth(world, sx[start], sy[start]))
		for (let k = start + 1; k < end; k++) {
			const phi = hydraulicPhi(sp[k], gravityDepth(world, sx[k], sy[k]))
			if (phi < sinkPhi) {
				sinkPhi = phi
				sink = k
			}
		}

		let need = false
		for (let k = start; k < end; k++) {
			if (k === sink) continue
			if (hydraulicPhi(sp[k], gravityDepth(world, sx[k], sy[k])) - sinkPhi > 0.35) {
				need = true
				break
			}
		}
		if (!need) continue

		floodClear(world)
		const sinkCell = sy[sink] * W + sx[sink]
		visit[sinkCell] = gen
		dist[sinkCell] = 0
		floodPush(world, sx[sink], sy[sink])
		for (let qi = 0; qi < world.floodQ.length; qi += 2) {
			const cx = world.floodQ[qi]
			const cy = world.floodQ[qi + 1]
			const d0 = dist[cy * W + cx]
			for (let o = 0; o < 4; o++) {
				const nx = cx + ORTHO_DX[o]
				const ny = cy + ORTHO_DY[o]
				if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
				const neighbor = ny * W + nx
				if (componentOf[neighbor] !== comp || visit[neighbor] === gen) continue
				visit[neighbor] = gen
				dist[neighbor] = d0 + 1
				floodPush(world, nx, ny)
			}
		}

		for (let k = start; k < end; k++) {
			if (k === sink) continue
			const phi = hydraulicPhi(sp[k], gravityDepth(world, sx[k], sy[k]))
			const delta = phi - sinkPhi
			if (delta <= 0.35) continue
			const cell = sy[k] * W + sx[k]
			if (visit[cell] !== gen || liq[cell] < 0.05) continue
			let bestNeighbor = -1
			let bestD = dist[cell]
			let bestDx = 0
			let bestDy = 0
			const x0 = sx[k]
			const y0 = sy[k]
			for (let o = 0; o < 4; o++) {
				const dx = ORTHO_DX[o]
				const dy = ORTHO_DY[o]
				const nx = x0 + dx
				const ny = y0 + dy
				if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
				const neighbor = ny * W + nx
				if (componentOf[neighbor] !== comp || visit[neighbor] !== gen || dist[neighbor] >= bestD) continue
				if (liq[neighbor] >= LIQ_FULL - 1e-6) continue
				bestD = dist[neighbor]
				bestNeighbor = neighbor
				bestDx = dx
				bestDy = dy
			}
			if (bestNeighbor < 0) continue
			const move = Math.min(0.12, liq[cell] * 0.35, delta * 0.08)
			transfer(world, liq, flowX, flowY, cell, bestNeighbor, bestDx, bestDy, move)
		}
	}
}

/**
 * 液体步进：压驱沉降、风驱液膜、土壤、图水力均衡。
 * 仅当粒子/抬升弄脏自由液体拓扑时重标空气。
 * @param {FluidWorld} world 流体世界
 */
export const stepLiquid = (world) => {
	const { worldW: W, worldH: H, mat, liq, liqVx, liqVy } = world
	if (world.airDirty) labelAirRegions(world)

	const n = W * H
	const flowX = scratch(world, 'liqFlowX', n, Float32Array)
	const flowY = scratch(world, 'liqFlowY', n, Float32Array)
	const colDirty = scratch(world, 'liqColDirty', W, Uint8Array)
	flowX.fill(0)
	flowY.fill(0)
	colDirty.fill(0)

	const pCache = scratch(world, 'liqP', n, Float32Array)
	for (let x = 0; x < W; x++) fillColumnPressure(world, x, pCache)

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

	// --- Vertical settle: column-major; refresh a column only after it transfers ---
	for (let x = 0; x < W; x++)
		for (let y = H - 2; y >= 0; y--) {
			const cell = y * W + x
			if (liq[cell] <= 0) continue
			if (isLiquidBarrier(mat[cell])) {
				const before = liq[cell]
				liq[cell] = 0
				markAirIfDrawCrossed(world, before, 0)
				continue
			}
			const below = cell + W
			if (isLiquidBarrier(mat[below]) || liq[below] >= LIQ_FULL) continue
			if (poolRetainBlocks(world, cell, below)) continue

			const pSrc = pAt(x, y)
			const pDst = pAt(x, y + 1)
			const room = LIQ_FULL - liq[below]
			let move = pressureMove(pSrc, pDst, liq[cell], room)
			// Near-equal stacked fills: still drain residual head into emptier below
			// when destination gas is not strongly over-pressured.
			if (move < 0.01 && liq[below] < liq[cell] && pDst < pSrc + RHO_G * 0.85)
				move = Math.min(liq[cell], room, Math.max(0.08, (liq[cell] - liq[below]) * 0.85))
			if (move > 0) {
				transfer(world, liq, flowX, flowY, cell, below, 0, 1, move)
				fillColumnPressure(world, x, pCache)
				continue
			}

			// Diagonal settle into emptier down-slope when blocked straight down.
			const dir = (x + y) & 1 ? 1 : -1
			let didDiag = false
			for (let pass = 0; pass < 2; pass++) {
				const dx = pass === 0 ? dir : -dir
				const nx = x + dx
				const ny = y + 1
				if (!canOccupy(world, nx, ny)) continue
				const neighbor = ny * W + nx
				if (liq[neighbor] >= liq[cell] || poolRetainBlocks(world, cell, neighbor)) continue
				const pN = liquidPressureAt(world, nx, ny)
				let m = pressureMove(pSrc, pN, liq[cell] * 0.5, LIQ_FULL - liq[neighbor])
				if (m <= 0.01)
					m = Math.min(liq[cell] * 0.5, (liq[cell] - liq[neighbor]) * 0.5, LIQ_FULL - liq[neighbor])
				if (m <= 0.01) continue
				transfer(world, liq, flowX, flowY, cell, neighbor, dx, 1, m)
				fillColumnPressure(world, x, pCache)
				fillColumnPressure(world, nx, pCache)
				didDiag = true
				break
			}
			if (didDiag) continue
		}

	// Vertical transfers already refreshed dirty columns — no second full WH fill.

	// --- Horizontal: free-surface sheet / submerged orifice / edge vent / wind ---
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (liq[cell] <= 0.05 || isLiquidBarrier(mat[cell])) continue
			const pSrc = pAt(x, y)
			const freeSurface = isFreeSurface(world, cell, x, y)

			for (let pass = 0; pass < 2; pass++) {
				const dx = pass === 0 ? -1 : 1
				const nx = x + dx
				if (nx < 0 || nx >= W) {
					const nb = neighborCoord(world, x, y, dx, 0)
					if (nb.wrapped) {
						const neighbor = nb.y * W + nb.x
						if (!isLiquidBarrier(mat[neighbor])) {
							const pDst = pAt(nb.x, nb.y)
							const room = LIQ_FULL - liq[neighbor]
							let move = freeSurface && liq[neighbor] < LIQ_DRAW
								? sheetMove(liq[cell], liq[neighbor], room)
								: pressureMove(pSrc, pDst, liq[cell], room)
							if (move > 0) {
								transfer(world, liq, flowX, flowY, cell, neighbor, dx, 0, move)
								colDirty[x] = 1
								colDirty[nb.x] = 1
							}
						}
					}
					else {
						const before = liq[cell]
						const move = freeSurface
							? before * 0.25
							: Math.min(
								before,
								Math.max(before * 0.2, Math.sqrt(Math.max(0, (pSrc - pressureAt(world, x, y)) / RHO_G)) * P_FLOW_GAIN),
							)
						liq[cell] -= move
						flowX[cell] += dx * move
						markAirIfDrawCrossed(world, before, liq[cell])
						colDirty[x] = 1
					}
					continue
				}
				const neighbor = cell + dx
				if (isLiquidBarrier(mat[neighbor])) continue
				if (poolRetainBlocks(world, cell, neighbor) && mat[neighbor] === MAT.AIR) continue
				if (sealedGasBlocks(world, neighbor, pSrc)) continue

				const pDst = pAt(nx, y)
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

				// Wind shear on free-surface sheets — gas ux pushes mass downwind.
				if (freeSurface && liq[cell] >= LIQ_DRAW) {
					const ux = gasUxAt(world, x, y > 0 ? y - 1 : y)
					if (ux * dx > 0.15) {
						const wind = Math.min(WIND_SHEET_CAP, Math.abs(ux) * WIND_SHEET, liq[cell] * 0.2, room)
						move = Math.max(move, wind)
					}
				}

				if (move > 0) {
					transfer(world, liq, flowX, flowY, cell, neighbor, dx, 0, move)
					colDirty[x] = 1
					colDirty[nx] = 1
				}
			}
		}

	for (let x = 0; x < W; x++)
		if (colDirty[x]) fillColumnPressure(world, x, pCache)

	// --- Sealed gas pushes adjacent free liquid away (down preferred, else sideways) ---
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
				const ty = ny + (dy === 0 ? 1 : dy)
				if (canOccupy(world, tx, ty) && liq[idx(world, tx, ty)] < LIQ_FULL) {
					const target = idx(world, tx, ty)
					transfer(world, liq, flowX, flowY, neighbor, target, tx - nx, ty - ny, push)
				}
				else if (dy === 0 && ny + 1 < H && canOccupy(world, nx, ny + 1)) {
					const target = idx(world, nx, ny + 1)
					transfer(world, liq, flowX, flowY, neighbor, target, 0, 1, push)
				}
			}
		}

	stepSoil(world)
	equalizeHydraulicAlongGraph(world, flowX, flowY)
	stepMeltTransport(world)
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
 * 熔岩沿重力沉降 + 侧向粘滞流。
 * @param {FluidWorld} world 世界
 * @returns {void}
 */
const stepMeltTransport = (world) => {
	const { worldW: W, worldH: H, mat, melt, temp, meltVx, meltVy } = world
	const n = W * H
	const flowX = scratch(world, 'meltFlowX', n, Float32Array)
	const flowY = scratch(world, 'meltFlowY', n, Float32Array)
	flowX.fill(0)
	flowY.fill(0)
	const { dx: ddx, dy: ddy } = gravityDownStep(world)

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (melt[cell] <= 0.02) continue
			if (isLiquidBarrier(mat[cell]) && mat[cell] !== MAT.AIR) continue
			const visc = meltVisc(world, cell)
			const nx = x + ddx
			const ny = y + ddy
			const nb = neighborCoord(world, x, y, ddx, ddy)
			if (nb.out) continue
			const tx = nb.x
			const ty = nb.y
			if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue
			const target = ty * W + tx
			if (isLiquidBarrier(mat[target]) && mat[target] !== MAT.AIR && mat[target] !== MAT.SOLID && mat[target] !== MAT.HORIZON)
				continue
			if (mat[target] === MAT.SOLID || mat[target] === MAT.HORIZON) continue
			const room = LIQ_FULL - melt[target]
			if (room <= 0) continue
			const pSrc = pressureAt(world, x, y) + RHO_G * melt[cell]
			const pDst = pressureAt(world, tx, ty) + RHO_G * melt[target]
			let move = pressureMove(pSrc, pDst, melt[cell], room, visc)
			if (move < 0.01 && melt[target] < melt[cell])
				move = Math.min(melt[cell] * 0.5, room, (melt[cell] - melt[target]) * 0.5) * (1 - Math.min(1, visc))
			if (move <= 0.01) continue
			const tSrc = temp[cell]
			const before = melt[cell]
			const beforeT = melt[target]
			const moved = applyTransfer(melt, flowX, flowY, cell, target, tx - x, ty - y, move)
			if (moved > 0) {
				const heat = tSrc * moved
				if (melt[cell] > 1e-8)
					temp[cell] = (temp[cell] * (before - moved) + /* remaining keeps temp */ temp[cell] * 0) / Math.max(melt[cell], 1e-8)
				// Mass-weighted temp at destination.
				const destMass = melt[target]
				const prevMass = destMass - moved
				temp[target] = prevMass > 0
					? (temp[target] * prevMass + heat) / destMass
					: tSrc
				if (melt[cell] <= 1e-8) temp[cell] = T_AMB
				markAirIfMeltDrawCrossed(world, before, melt[cell])
				markAirIfMeltDrawCrossed(world, beforeT, melt[target])
			}
		}

	// Side sheet for melt (perpendicular to gravity).
	const sideA = ddx === 0 ? { dx: -1, dy: 0 } : { dx: 0, dy: -1 }
	const sideB = { dx: -sideA.dx, dy: -sideA.dy }
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (melt[cell] < LIQ_DRAW) continue
			const visc = meltVisc(world, cell)
			for (const side of [sideA, sideB]) {
				const nb = neighborCoord(world, x, y, side.dx, side.dy)
				if (nb.out) continue
				const target = nb.y * W + nb.x
				if (isLiquidBarrier(mat[target]) && mat[target] !== MAT.AIR) continue
				if (mat[target] === MAT.SOLID || mat[target] === MAT.HORIZON) continue
				const room = LIQ_FULL - melt[target]
				const move = sheetMove(melt[cell], melt[target], room, visc)
				if (move <= 0) continue
				const tSrc = temp[cell]
				const before = melt[cell]
				const beforeT = melt[target]
				const moved = applyTransfer(melt, flowX, flowY, cell, target, nb.x - x, nb.y - y, move)
				if (moved > 0) {
					const destMass = melt[target]
					const prevMass = destMass - moved
					temp[target] = prevMass > 0
						? (temp[target] * prevMass + tSrc * moved) / destMass
						: tSrc
					if (melt[cell] <= 1e-8) temp[cell] = T_AMB
					markAirIfMeltDrawCrossed(world, before, melt[cell])
					markAirIfMeltDrawCrossed(world, beforeT, melt[target])
				}
			}
		}

	for (let i = 0; i < n; i++) {
		const m = melt[i]
		if (m < 1e-6) {
			meltVx[i] = 0
			meltVy[i] = 0
			continue
		}
		meltVx[i] = meltVx[i] * 0.35 + (flowX[i] / m) * 0.65
		meltVy[i] = meltVy[i] * 0.35 + (flowY[i] / m) * 0.65
	}
}

/**
 * 沿重力轴：下方更轻则与上方交换（对流 / 气泡）。
 * @param {FluidWorld} world 世界
 * @returns {void}
 */
const stepBuoyancy = (world) => {
	const { worldW: W, worldH: H, melt, liq, temp, mat } = world
	const { dx, dy } = gravityDownStep(world)
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const belowX = x + dx
			const belowY = y + dy
			if (!inWorld(world, belowX, belowY)) continue
			const a = y * W + x
			const b = belowY * W + belowX
			if (isLiquidBarrier(mat[a]) || isLiquidBarrier(mat[b])) continue
			const rhoA = cellRho(world, a)
			const rhoB = cellRho(world, b)
			// Below should be denser; if below is lighter, swap fluid contents.
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
