/**
 * 分量内势能均衡：同一算子的两个极限。
 *   mobility = ∞  → 一次取均值（Boyle / 开放 Dirichlet）
 *   mobility 有限 → 沿液体图最低-φ BFS 松弛
 */

import { ORTHO_DX, ORTHO_DY } from '../../hash.mjs'

import { hydraulicPhi, applyTransfer } from '../flow.mjs'
import { pressureAt } from '../gas.mjs'
import { P_ATM, LIQ_DRAW, LIQ_FULL, isLiquidBarrier } from '../mat.mjs'
import {
	scratch, growScratch, floodClear, floodPush, gravityDepth,
	gravityUpWeights, strongestUp, inWorld,
	markAirIfDrawCrossed,
} from '../world.mjs'

/** @typedef {import('../world.mjs').FluidWorld} FluidWorld */

/**
 * 密闭气区 Boyle 均值（mobility = ∞）。
 * @param {FluidWorld} world 世界
 * @param {import('./gas.mjs').AirRegion} region 气区
 * @returns {void}
 */
export const equilibrateSealedBoyle = (world, region) => {
	if (region.openToAtm) {
		region.pressure = P_ATM
		return
	}
	region.pressure = Math.max(0.05, Math.min(8,
		region.gasAmount / Math.max(0.25, region.airCells)))
}

/**
 * 将一自由面样本压入复用 SoA 暂存。
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
 * 标注连通液体分量；自由面存为 SoA。
 * @param {FluidWorld} world 流体世界
 * @returns {{
 *   surf: { x: Int32Array, y: Int32Array, c: Int32Array, p: Float32Array, n: number },
 *   componentOf: Int32Array,
 * }} 自由面样本与每格分量 id
 */
export const labelLiquidComponents = (world) => {
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

	const upW = gravityUpWeights(world)
	const up = strongestUp(world)

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
				let isSurf = upW.n <= 0
				if (!isSurf) {
					isSurf = true
					for (let o = 0; o < upW.n; o++) {
						const ax = cx + upW.dx[o]
						const ay = cy + upW.dy[o]
						if (!inWorld(world, ax, ay)) continue
						const above = ay * W + ax
						if (!isLiquidBarrier(mat[above]) && liq[above] >= LIQ_DRAW) {
							isSurf = false
							break
						}
					}
				}
				if (isSurf) {
					let airP = pressureAt(world, cx, cy)
					if (up.w > 0) {
						const ax = cx + up.dx
						const ay = cy + up.dy
						if (inWorld(world, ax, ay) && !isLiquidBarrier(mat[ay * W + ax]))
							airP = pressureAt(world, ax, ay)
					}
					pushSurface(world, cx, cy, id, airP, surf)
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
 * 分量内自由面样本的最低 φ 汇点索引。
 * @param {{ x: Int32Array, y: Int32Array, p: Float32Array }} surf 自由面 SoA
 * @param {FluidWorld} world 世界
 * @param {number} start 分量起始
 * @param {number} end 分量结束（不含）
 * @returns {number} 汇点索引
 */
const sinkOfComponent = (surf, world, start, end) => {
	const { x: sx, y: sy, p: sp } = surf
	let sink = start
	let sinkPhi = hydraulicPhi(sp[start], gravityDepth(world, sx[start], sy[start]))
	for (let k = start + 1; k < end; k++) {
		const phi = hydraulicPhi(sp[k], gravityDepth(world, sx[k], sy[k]))
		if (phi < sinkPhi) {
			sinkPhi = phi
			sink = k
		}
	}
	return sink
}

/**
 * 从汇点沿液体图 BFS 填距离场。
 * @param {FluidWorld} world 世界
 * @param {Int32Array} componentOf 分量 id
 * @param {Int32Array} dist 距离输出
 * @param {Int32Array} visit 访问代
 * @param {number} gen 当前代
 * @param {number} comp 分量 id
 * @param {number} sink 汇点索引
 * @param {{ x: Int32Array, y: Int32Array }} surf 自由面 SoA
 * @returns {number} sinkPhi
 */
const buildDistField = (world, componentOf, dist, visit, gen, comp, sink, surf) => {
	const { worldW: W, worldH: H } = world
	const { x: sx, y: sy, p: sp } = surf
	const sinkPhi = hydraulicPhi(sp[sink], gravityDepth(world, sx[sink], sy[sink]))
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
	return sinkPhi
}

/**
 * 沿 dist 场向汇点松弛一液体分量。
 * @param {FluidWorld} world 世界
 * @param {Float32Array} flowX 流累加器
 * @param {Float32Array} flowY 流累加器
 * @param {Float32Array} liq 液体场
 * @param {Int32Array} componentOf 分量 id
 * @param {Int32Array} dist 距离场
 * @param {Int32Array} visit 访问代
 * @param {number} gen 当前代
 * @param {number} comp 分量 id
 * @param {number} start 分量起始
 * @param {number} end 分量结束（不含）
 * @param {number} sink 汇点索引
 * @param {number} sinkPhi 汇点势
 * @param {number} mobility 迁移率
 * @param {{ x: Int32Array, y: Int32Array, p: Float32Array }} surf 自由面 SoA
 * @returns {void}
 */
const relaxComponent = (world, flowX, flowY, liq, componentOf, dist, visit, gen, comp, start, end, sink, sinkPhi, mobility, surf) => {
	const { worldW: W } = world
	const { x: sx, y: sy, p: sp } = surf
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
			if (nx < 0 || ny < 0 || nx >= W || ny >= world.worldH) continue
			const neighbor = ny * W + nx
			if (componentOf[neighbor] !== comp || visit[neighbor] !== gen || dist[neighbor] >= bestD) continue
			if (liq[neighbor] >= LIQ_FULL - 1e-6) continue
			bestD = dist[neighbor]
			bestNeighbor = neighbor
			bestDx = dx
			bestDy = dy
		}
		if (bestNeighbor < 0) continue
		const move = Math.min(0.12, liq[cell] * 0.35, delta * 0.08) * mobility
		const a0 = liq[cell]
		const b0 = liq[bestNeighbor]
		const m = applyTransfer(liq, flowX, flowY, cell, bestNeighbor, bestDx, bestDy, move)
		if (m > 0) {
			markAirIfDrawCrossed(world, a0, liq[cell])
			markAirIfDrawCrossed(world, b0, liq[bestNeighbor])
		}
	}
}

/**
 * 沿液体图有限 mobility 松弛 φ。
 * @param {FluidWorld} world 流体世界
 * @param {Float32Array} flowX 流累加器
 * @param {Float32Array} flowY 流累加器
 * @param {number} [mobility=1] 相对迁移率（缩放流量）
 * @returns {void}
 */
export const equilibrateHydraulic = (world, flowX, flowY, mobility = 1) => {
	if (!(mobility > 0) || !Number.isFinite(mobility)) return
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

		const sink = sinkOfComponent(surf, world, start, end)
		const sinkPhi = hydraulicPhi(sp[sink], gravityDepth(world, sx[sink], sy[sink]))

		let need = false
		for (let k = start; k < end; k++) {
			if (k === sink) continue
			if (hydraulicPhi(sp[k], gravityDepth(world, sx[k], sy[k])) - sinkPhi > 0.35) {
				need = true
				break
			}
		}
		if (!need) continue

		const builtPhi = buildDistField(world, componentOf, dist, visit, gen, comp, sink, surf)
		relaxComponent(world, flowX, flowY, liq, componentOf, dist, visit, gen, comp, start, end, sink, builtPhi, mobility, surf)
	}
}
