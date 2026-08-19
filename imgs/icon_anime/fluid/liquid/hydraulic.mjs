/**
 * 液体连通分量内的液压势 φ 松弛（连通器）。
 * φ = P/(ρg) − depth；沿液体图从最低-φ 自由面 BFS 松弛，无瞬移。
 *
 * Boyle 密闭气压在 `gas/`；本文件只管液体 φ。
 */

import { ORTHO_DX, ORTHO_DY } from '../../hash.mjs'
import { clearLabels, labelComponents, recycleComponents } from '../components.mjs'
import { hydraulicPhi, applyTransfer } from '../flow.mjs'
import { pressureAt } from '../gas/index.mjs'
import { LIQ_DRAW, LIQ_FULL, isLiquidBarrier } from '../mat.mjs'
import {
	scratch, growScratch, floodClear, floodPush, fillCellDepths,
	gravityUpWeights, strongestUp, inWorld,
	markAirIfDrawCrossed, isLiquidFreeSurface,
} from '../world/index.mjs'

/** @typedef {import('../world/index.mjs').FluidWorld} FluidWorld */

/** @typedef {{
 *   x: Int32Array, y: Int32Array, c: Int32Array, p: Float32Array, phi: Float32Array, n: number,
 *   prefix: string,
 * }} SurfSoa */

/**
 * 空自由面 SoA 壳（typed 缓冲挂在 world.scratch）。
 * @param {string} prefix scratch 键前缀（如 `liqSurf` / `meltSurf`）
 * @returns {SurfSoa} 壳
 */
const emptySurfSoa = (prefix) => ({
	x: new Int32Array(0),
	y: new Int32Array(0),
	c: new Int32Array(0),
	p: new Float32Array(0),
	phi: new Float32Array(0),
	n: 0,
	prefix,
})

/**
 * 将 SoA 绑到 world.scratch 缓冲并清空计数。
 * @param {FluidWorld} world 流体世界
 * @param {SurfSoa} surf 自由面壳
 * @returns {SurfSoa} surf
 */
const bindSurfScratch = (world, surf) => {
	const { prefix } = surf
	surf.x = growScratch(world, `${prefix}X`, 64, Int32Array)
	surf.y = growScratch(world, `${prefix}Y`, 64, Int32Array)
	surf.c = growScratch(world, `${prefix}C`, 64, Int32Array)
	surf.p = growScratch(world, `${prefix}P`, 64, Float32Array)
	surf.phi = growScratch(world, `${prefix}Phi`, 64, Float32Array)
	surf.n = 0
	return surf
}

/**
 * 将一自由面样本压入复用 SoA 暂存。
 * @param {FluidWorld} world 流体世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} component 连通分量 id
 * @param {number} pressure 面上方空气压
 * @param {number} phi 液压势
 * @param {SurfSoa} surf 自由面 SoA
 */
const pushSurface = (world, x, y, component, pressure, phi, surf) => {
	const { n } = surf
	if (n >= surf.x.length) {
		const { prefix } = surf
		surf.x = growScratch(world, `${prefix}X`, n + 1, Int32Array)
		surf.y = growScratch(world, `${prefix}Y`, n + 1, Int32Array)
		surf.c = growScratch(world, `${prefix}C`, n + 1, Int32Array)
		surf.p = growScratch(world, `${prefix}P`, n + 1, Float32Array)
		surf.phi = growScratch(world, `${prefix}Phi`, n + 1, Float32Array)
	}
	surf.x[n] = x
	surf.y[n] = y
	surf.c[n] = component
	surf.p[n] = pressure
	surf.phi[n] = phi
	surf.n = n + 1
}

/** 水自由面 SoA 壳。 */
const SURF_SOA = emptySurfSoa('liqSurf')
/** 熔岩自由面 SoA 壳。 */
const MELT_SURF_SOA = emptySurfSoa('meltSurf')

/** `labelLiquidComponents` 返回壳。 */
const LIQ_COMP_OUT = {
	surf: SURF_SOA,
	/** @type {Int32Array | null} */
	componentOf: null,
}

/** `labelMeltComponents` 返回壳。 */
const MELT_COMP_OUT = {
	surf: MELT_SURF_SOA,
	/** @type {Int32Array | null} */
	componentOf: null,
}

/** 液体分量标注上下文（accept/onCell 读此，避免每 tick 新闭包）。 */
const LIQ_LABEL_CTX = {
	/** @type {FluidWorld | null} */
	world: null,
	/** @type {{ dx: number[], dy: number[], w: number[], n: number } | null} */
	upW: null,
	/** @type {{ dx: number, dy: number, w: number } | null} */
	up: null,
	/** @type {Float32Array | null} */
	depth: null,
	surf: SURF_SOA,
	W: 0,
}

/**
 * @param {FluidWorld} world 世界
 * @param {number} cell 索引
 * @returns {boolean} 可标注液体
 */
const acceptLiquidCell = (world, cell) =>
	world.liq[cell] >= LIQ_DRAW && !isLiquidBarrier(world.mat[cell])

/**
 * @param {FluidWorld} world 世界
 * @param {number} cell 索引
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} id 分量 id
 * @returns {void}
 */
const onLiquidCell = (world, cell, x, y, id) => {
	const ctx = LIQ_LABEL_CTX
	const upW = /** @type {{ dx: number[], dy: number[], w: number[], n: number }} */ ctx.upW
	if (!isLiquidFreeSurface(world, x, y, upW)) return
	const up = /** @type {{ dx: number, dy: number, w: number }} */ ctx.up
	const depth = /** @type {Float32Array} */ ctx.depth
	const { W } = ctx
	let airP = pressureAt(world, x, y)
	if (up.w > 0) {
		const ax = x + up.dx
		const ay = y + up.dy
		if (inWorld(world, ax, ay) && !isLiquidBarrier(world.mat[ay * W + ax]))
			airP = pressureAt(world, ax, ay)
	}
	pushSurface(world, x, y, id, airP, hydraulicPhi(airP, depth[cell]), ctx.surf)
}

/** 熔岩分量标注上下文。 */
const MELT_LABEL_CTX = {
	/** @type {{ dx: number[], dy: number[], w: number[], n: number } | null} */
	upW: null,
	/** @type {{ dx: number, dy: number, w: number } | null} */
	up: null,
	/** @type {Float32Array | null} */
	depth: null,
	surf: MELT_SURF_SOA,
	W: 0,
}

/**
 * @param {FluidWorld} world 世界
 * @param {number} cell 索引
 * @returns {boolean} 可标注熔岩
 */
const acceptMeltCell = (world, cell) =>
	world.melt[cell] >= LIQ_DRAW && !isLiquidBarrier(world.mat[cell])

/**
 * @param {FluidWorld} world 世界
 * @param {number} cell 索引
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} id 分量 id
 * @returns {void}
 */
const onMeltCell = (world, cell, x, y, id) => {
	const ctx = MELT_LABEL_CTX
	const upW = /** @type {{ dx: number[], dy: number[], w: number[], n: number }} */ ctx.upW
	const { W } = ctx
	let free = true
	for (let i = 0; i < upW.n; i++) {
		const ax = x + upW.dx[i]
		const ay = y + upW.dy[i]
		if (!inWorld(world, ax, ay)) continue
		const above = ay * W + ax
		if (!isLiquidBarrier(world.mat[above]) && world.melt[above] >= LIQ_DRAW) {
			free = false
			break
		}
	}
	if (!free) return
	const up = /** @type {{ dx: number, dy: number, w: number }} */ ctx.up
	const depth = /** @type {Float32Array} */ ctx.depth
	let airP = pressureAt(world, x, y)
	if (up.w > 0) {
		const ax = x + up.dx
		const ay = y + up.dy
		if (inWorld(world, ax, ay) && !isLiquidBarrier(world.mat[ay * W + ax]))
			airP = pressureAt(world, ax, ay)
	}
	pushSurface(world, x, y, id, airP, hydraulicPhi(airP, depth[cell]), ctx.surf)
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
	const surf = bindSurfScratch(world, SURF_SOA)

	const upW = gravityUpWeights(world)
	const up = strongestUp(world, upW)
	const depth = fillCellDepths(world)

	LIQ_LABEL_CTX.upW = upW
	LIQ_LABEL_CTX.up = up
	LIQ_LABEL_CTX.depth = depth
	LIQ_LABEL_CTX.surf = surf
	LIQ_LABEL_CTX.W = W

	const { components } = labelComponents(world, {
		accept: acceptLiquidCell,
		labels: componentOf,
		poolKey: 'liqComponentPool',
		onCell: onLiquidCell,
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
			if (liq[neighbor] + world.melt[neighbor] >= LIQ_FULL - 1e-6) continue
			bestD = dist[neighbor]
			bestNeighbor = neighbor
			bestDx = dx
			bestDy = dy
		}
		if (bestNeighbor < 0) continue
		const room = LIQ_FULL - liq[bestNeighbor] - world.melt[bestNeighbor]
		if (room <= 1e-6) continue
		const move = Math.min(0.12, liq[cell] * 0.35, delta * 0.08, room) * mobility
		const a0 = liq[cell]
		const b0 = liq[bestNeighbor]
		const m = applyTransfer(liq, flowX, flowY, cell, bestNeighbor, bestDx, bestDy, move, room)
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

/**
 * 标注熔岩连通分量与自由面 φ（独立于水，禁止水–熔岩经 φ 互抽）。
 * @param {FluidWorld} world 流体世界
 * @returns {{
 *   surf: { x: Int32Array, y: Int32Array, c: Int32Array, p: Float32Array, phi: Float32Array, n: number },
 *   componentOf: Int32Array,
 * }} 自由面样本与每格分量 id
 */
export const labelMeltComponents = (world) => {
	const W = world.worldW
	const componentOf = clearLabels(world, 'meltComp', W * world.worldH)
	const surf = bindSurfScratch(world, MELT_SURF_SOA)

	const upW = gravityUpWeights(world)
	const up = strongestUp(world, upW)
	const depth = fillCellDepths(world)

	MELT_LABEL_CTX.upW = upW
	MELT_LABEL_CTX.up = up
	MELT_LABEL_CTX.depth = depth
	MELT_LABEL_CTX.surf = surf
	MELT_LABEL_CTX.W = W

	const { components } = labelComponents(world, {
		accept: acceptMeltCell,
		labels: componentOf,
		poolKey: 'meltComponentPool',
		onCell: onMeltCell,
	})
	recycleComponents(world, components, 'meltComponentPool')
	MELT_COMP_OUT.surf = surf
	MELT_COMP_OUT.componentOf = componentOf
	return MELT_COMP_OUT
}

/**
 * 熔岩连通器 φ 松弛（mobility 由粘滞增益给出）。
 * @param {FluidWorld} world 流体世界
 * @param {Float32Array} flowX 流累加器
 * @param {Float32Array} flowY 流累加器
 * @param {number} [mobility=1] 迁移率
 * @returns {void}
 */
export const equilibrateMeltHydraulic = (world, flowX, flowY, mobility = 1) => {
	const { surf, componentOf } = labelMeltComponents(world)
	const { n: surfN, c: sc, phi } = surf
	if (surfN < 2) return

	const { worldW: W, melt } = world
	const n = W * world.worldH
	const dist = scratch(world, 'meltHydroDist', n, Int32Array)
	const visit = scratch(world, 'meltHydroVisit', n, Int32Array)
	let gen = (/** @type {number} */ world.scratch.meltHydroGen | 0) + 1
	if (gen >= 0x7fffffff) {
		visit.fill(0)
		gen = 1
	}
	world.scratch.meltHydroGen = gen

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

		const { x: sx, y: sy } = surf
		for (let k = start; k < end; k++) {
			if (k === sink) continue
			const delta = phi[k] - sinkPhi
			if (delta <= 0.35) continue
			const cell = sy[k] * W + sx[k]
			if (visit[cell] !== gen || melt[cell] < 0.05) continue
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
				if (melt[neighbor] + world.liq[neighbor] >= LIQ_FULL - 1e-6) continue
				bestD = dist[neighbor]
				bestNeighbor = neighbor
				bestDx = dx
				bestDy = dy
			}
			if (bestNeighbor < 0) continue
			const room = LIQ_FULL - melt[bestNeighbor] - world.liq[bestNeighbor]
			if (room <= 1e-6) continue
			const move = Math.min(0.12, melt[cell] * 0.35, delta * 0.08, room) * mobility
			const a0 = melt[cell]
			const b0 = melt[bestNeighbor]
			const m = applyTransfer(melt, flowX, flowY, cell, bestNeighbor, bestDx, bestDy, move, room)
			if (m > 0) {
				// Carry temperature with mass.
				const tSrc = world.temp[cell]
				const heat = tSrc * m
				const destMass = melt[bestNeighbor]
				const prevMass = destMass - m
				world.temp[bestNeighbor] = prevMass > 0
					? (world.temp[bestNeighbor] * prevMass + heat) / destMass
					: tSrc
				if (melt[cell] <= 1e-8) world.temp[cell] = 0
				markAirIfDrawCrossed(world, a0, melt[cell])
				markAirIfDrawCrossed(world, b0, melt[bestNeighbor])
			}
		}
	}
}
