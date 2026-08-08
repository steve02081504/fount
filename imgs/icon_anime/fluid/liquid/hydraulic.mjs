/**
 * 液体连通分量内的液压势 φ 松弛（连通器）。
 * φ = P/(ρg) − depth；沿液体图从最低-φ 自由面 BFS 松弛，无瞬移。
 *
 * Boyle 密闭气压在 `gas.mjs`；本文件只管液体 φ。
 */

import { ORTHO_DX, ORTHO_DY } from '../../hash.mjs'
import { clearLabels, labelComponents, recycleComponents } from '../components.mjs'
import { hydraulicPhi, applyTransfer } from '../flow.mjs'
import { pressureAt } from '../gas.mjs'
import { LIQ_DRAW, LIQ_FULL, isLiquidBarrier } from '../mat.mjs'
import {
	scratch, growScratch, floodClear, floodPush, fillCellDepths,
	gravityUpWeights, strongestUp, inWorld,
	markAirIfDrawCrossed, isLiquidFreeSurface,
} from '../world.mjs'

/** @typedef {import('../world.mjs').FluidWorld} FluidWorld */

/**
 * 将一自由面样本压入复用 SoA 暂存。
 * @param {FluidWorld} world 流体世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} component 连通分量 id
 * @param {number} pressure 面上方空气压
 * @param {number} phi 液压势
 * @param {{
 *   x: Int32Array, y: Int32Array, c: Int32Array, p: Float32Array, phi: Float32Array, n: number,
 * }} surf 自由面 SoA
 */
const pushSurface = (world, x, y, component, pressure, phi, surf) => {
	const n = surf.n
	if (n >= surf.x.length) {
		surf.x = growScratch(world, 'liqSurfX', n + 1, Int32Array)
		surf.y = growScratch(world, 'liqSurfY', n + 1, Int32Array)
		surf.c = growScratch(world, 'liqSurfC', n + 1, Int32Array)
		surf.p = growScratch(world, 'liqSurfP', n + 1, Float32Array)
		surf.phi = growScratch(world, 'liqSurfPhi', n + 1, Float32Array)
	}
	surf.x[n] = x
	surf.y[n] = y
	surf.c[n] = component
	surf.p[n] = pressure
	surf.phi[n] = phi
	surf.n = n + 1
}

/** 自由面 SoA 壳（typed 缓冲挂在 world.scratch）。 */
const SURF_SOA = {
	/** @type {Int32Array} */
	x: new Int32Array(0),
	/** @type {Int32Array} */
	y: new Int32Array(0),
	/** @type {Int32Array} */
	c: new Int32Array(0),
	/** @type {Float32Array} */
	p: new Float32Array(0),
	/** @type {Float32Array} */
	phi: new Float32Array(0),
	n: 0,
}

/** `labelLiquidComponents` 返回壳。 */
const LIQ_COMP_OUT = {
	surf: SURF_SOA,
	/** @type {Int32Array | null} */
	componentOf: null,
}

/**
 * 标注连通液体分量；自由面存为 SoA（含预计算 φ）。
 * @param {FluidWorld} world 流体世界
 * @returns {{
 *   surf: { x: Int32Array, y: Int32Array, c: Int32Array, p: Float32Array, phi: Float32Array, n: number },
 *   componentOf: Int32Array,
 * }} 自由面样本与每格分量 id（复用壳）
 */
export const labelLiquidComponents = (world) => {
	const W = world.worldW
	const componentOf = clearLabels(world, 'liqComp', W * world.worldH)
	const surf = SURF_SOA
	surf.x = growScratch(world, 'liqSurfX', 64, Int32Array)
	surf.y = growScratch(world, 'liqSurfY', 64, Int32Array)
	surf.c = growScratch(world, 'liqSurfC', 64, Int32Array)
	surf.p = growScratch(world, 'liqSurfP', 64, Float32Array)
	surf.phi = growScratch(world, 'liqSurfPhi', 64, Float32Array)
	surf.n = 0

	const upW = gravityUpWeights(world)
	const up = strongestUp(world, upW)
	const depth = fillCellDepths(world)

	const { components } = labelComponents(world, {
		/**
		 * 是否为连通液体分量成员。
		 * @param {FluidWorld} world 流体世界
		 * @param {number} cell 扁平索引
		 * @returns {boolean} 可标注
		 */
		accept: (world, cell) => world.liq[cell] >= LIQ_DRAW && !isLiquidBarrier(world.mat[cell]),
		labels: componentOf,
		poolKey: 'liqComponentPool',
		/**
		 * 标注格时收集自由面样本。
		 * @param {FluidWorld} world 流体世界
		 * @param {number} cell 扁平索引
		 * @param {number} x 列
		 * @param {number} y 行
		 * @param {number} id 分量 id
		 * @returns {void}
		 */
		onCell: (world, cell, x, y, id) => {
			if (!isLiquidFreeSurface(world, x, y, upW)) return
			let airP = pressureAt(world, x, y)
			if (up.w > 0) {
				const ax = x + up.dx
				const ay = y + up.dy
				if (inWorld(world, ax, ay) && !isLiquidBarrier(world.mat[ay * W + ax]))
					airP = pressureAt(world, ax, ay)
			}
			pushSurface(world, x, y, id, airP, hydraulicPhi(airP, depth[cell]), surf)
		},
	})
	recycleComponents(world, components, 'liqComponentPool')

	LIQ_COMP_OUT.surf = surf
	LIQ_COMP_OUT.componentOf = componentOf
	return LIQ_COMP_OUT
}

/**
 * 分量内自由面样本的最低 φ 汇点索引。
 * @param {{ phi: Float32Array }} surf 自由面 SoA
 * @param {number} start 分量起始
 * @param {number} end 分量结束（不含）
 * @returns {number} 汇点索引
 */
const sinkOfComponent = (surf, start, end) => {
	const { phi } = surf
	let sink = start
	let sinkPhi = phi[start]
	for (let k = start + 1; k < end; k++) {
		const p = phi[k]
		if (p < sinkPhi) {
			sinkPhi = p
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
 * @returns {void}
 */
const buildDistField = (world, componentOf, dist, visit, gen, comp, sink, surf) => {
	const { worldW: W, worldH: H } = world
	const { x: sx, y: sy } = surf
	floodClear(world)
	const sinkCell = sy[sink] * W + sx[sink]
	visit[sinkCell] = gen
	dist[sinkCell] = 0
	floodPush(world, sx[sink], sy[sink])
	for (let qi = 0; qi < world.floodLen; qi += 2) {
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
 * @param {{ x: Int32Array, y: Int32Array, phi: Float32Array }} surf 自由面 SoA
 * @returns {void}
 */
const relaxComponent = (world, flowX, flowY, liq, componentOf, dist, visit, gen, comp, start, end, sink, sinkPhi, mobility, surf) => {
	const { worldW: W, worldH: H } = world
	const { x: sx, y: sy, phi } = surf
	for (let k = start; k < end; k++) {
		if (k === sink) continue
		const delta = phi[k] - sinkPhi
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
	const { surf, componentOf } = labelLiquidComponents(world)
	const { n: surfN, c: sc, phi } = surf
	if (surfN < 2) return

	const { worldW: W, liq } = world
	const n = W * world.worldH
	const dist = scratch(world, 'liqHydroDist', n, Int32Array)
	const visit = scratch(world, 'liqHydroVisit', n, Int32Array)
	let gen = (/** @type {number} */ world.scratch.liqHydroGen | 0) + 1
	if (gen >= 0x7fffffff) {
		visit.fill(0)
		gen = 1
	}
	world.scratch.liqHydroGen = gen

	let i = 0
	while (i < surfN) {
		const comp = sc[i]
		const start = i
		while (i < surfN && sc[i] === comp) i++
		const end = i
		if (end - start < 2) continue

		const sink = sinkOfComponent(surf, start, end)
		const sinkPhi = phi[sink]

		let need = false
		for (let k = start; k < end; k++) {
			if (k === sink) continue
			if (phi[k] - sinkPhi > 0.35) {
				need = true
				break
			}
		}
		if (!need) continue

		buildDistField(world, componentOf, dist, visit, gen, comp, sink, surf)
		relaxComponent(world, flowX, flowY, liq, componentOf, dist, visit, gen, comp, start, end, sink, sinkPhi, mobility, surf)
	}
}
