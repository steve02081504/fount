/**
 * 重力相对边界：分数边角色 + 做功积分曝露。
 * 下向边累积 exposure → 岩浆源；上向边出雨/吸收与回吐。
 */

import {
	edgeRoles, EDGE_TOP, EDGE_BOTTOM, EDGE_LEFT,
} from './edges.mjs'
import {
	MAT, LIQ_FULL, T_MAX, T_AMB, LAVA_ONSET_EXPOSURE,
} from './mat.mjs'
import { markAirIfDrawCrossed, markAirIfMeltDrawCrossed, addMelt } from './world/index.mjs'

/** @typedef {import('./world/index.mjs').FluidWorld} FluidWorld */

/** 下边每 tick 注入熔岩质量（满 sink 权重时）。 */
const LAVA_INJECT = 0.35
/** 上边回吐每 tick 质量上限。 */
const REGURG_RATE = 0.4
/** 回吐触发：ĝ·absorbDir 低于此值。 */
const REGURG_DOT = 0.35

/**
 * 回吐温度剖面：先增后减，以吸收均温为起点。
 * @param {number} startTemp 起点温度
 * @param {number} phase [0, 1] 进度
 * @returns {number} 温度
 */
export const regurgitateTemp = (startTemp, phase) => {
	const p = Math.min(1, Math.max(0, phase))
	const peak = Math.min(T_MAX, startTemp + (T_MAX - startTemp) * 0.55)
	if (p < 0.5) {
		const t = p * 2
		return startTemp + (peak - startTemp) * t
	}
	const t = (p - 0.5) * 2
	return peak + (T_AMB - peak) * t
}

/**
 * 收集一边上的全部格索引。
 * @param {FluidWorld} world 世界
 * @param {number} edge 边
 * @param {number[]} out 输出
 * @returns {void}
 */
const collectEdgeCells = (world, edge, out) => {
	const { worldW: W, worldH: H } = world
	out.length = 0
	if (edge === EDGE_TOP)
		for (let x = 0; x < W; x++) out.push(x)
	else if (edge === EDGE_BOTTOM)
		for (let x = 0; x < W; x++) out.push((H - 1) * W + x)
	else if (edge === EDGE_LEFT)
		for (let y = 0; y < H; y++) out.push(y * W)
	else
		for (let y = 0; y < H; y++) out.push(y * W + (W - 1))
}

/**
 * 四边曝露做功积分；重力翻转时衰减。
 * @param {FluidWorld} world 世界
 * @param {import('./edges.mjs').EdgeRole[]} roles 边角色
 * @returns {void}
 */
const accumulateExposure = (world, roles) => {
	const { gravity, boundary } = world
	const exposure = boundary.exposure
	for (let e = 0; e < 4; e++) {
		const delta = roles[e].nx * gravity.gx + roles[e].ny * gravity.gy
		exposure[e] = Math.max(0, exposure[e] + delta)
	}
}

/**
 * 边角色遍历：岩浆注入、液体清除、上向吸收。
 * @param {FluidWorld} world 世界
 * @param {import('./edges.mjs').EdgeRole[]} roles 边角色
 * @returns {void}
 */
const stepEdgeExchange = (world, roles) => {
	const { worldW: W, mat, liq, melt, temp, gravity, boundary } = world
	/** @type {number[]} */
	const cells = []

	for (let e = 0; e < 4; e++) {
		const sink = roles[e].sink
		const source = roles[e].source
		if (sink < 0.05 && source < 0.05) continue
		collectEdgeCells(world, e, cells)

		const lavaOn = boundary.exposure[e] >= LAVA_ONSET_EXPOSURE && sink > 0.05
		if (lavaOn) {
			const inject = LAVA_INJECT * sink
			for (const cell of cells) {
				if (
					mat[cell] === MAT.POOL || mat[cell] === MAT.BODY || mat[cell] === MAT.SEAL
					|| mat[cell] === MAT.SLOPE_L || mat[cell] === MAT.SLOPE_R
				)
					continue
				const beforeL = liq[cell]
				if (beforeL > 0) {
					liq[cell] = 0
					markAirIfDrawCrossed(world, beforeL, 0)
				}
				if (mat[cell] === MAT.SOLID || mat[cell] === MAT.HORIZON) {
					mat[cell] = MAT.AIR
					world.airDirty = true
					world.gasGeomDirty = true
				}
				const before = Number.isFinite(melt[cell]) ? melt[cell] : 0
				melt[cell] = Math.min(LIQ_FULL, Math.max(before, inject))
				temp[cell] = T_MAX
				markAirIfMeltDrawCrossed(world, before, melt[cell])
			}
		}
		else if (sink > 0.15)
			for (const cell of cells) {
				const before = liq[cell]
				if (before > 0) {
					liq[cell] = 0
					markAirIfDrawCrossed(world, before, 0)
				}
			}

		if (source > 0.15 && !boundary.regurgitating)
			for (const cell of cells) 
				if (melt[cell] > 0.02) {
					const take = melt[cell] * source
					boundary.absorbedUnits += take
					boundary.absorbedHeat += take * temp[cell]
					boundary.absorbGx = gravity.gx
					boundary.absorbGy = gravity.gy
					const before = melt[cell]
					melt[cell] -= take
					if (melt[cell] < 1e-6) {
						melt[cell] = 0
						temp[cell] = T_AMB
					}
					markAirIfMeltDrawCrossed(world, before, melt[cell])
				}
			
	}
}

/**
 * 吸收方向偏离重力时回吐熔岩。
 * @param {FluidWorld} world 世界
 * @param {import('./edges.mjs').EdgeRole[]} roles 边角色
 * @returns {void}
 */
const stepRegurgitation = (world, roles) => {
	const { worldW: W, gravity, boundary } = world
	const absorbDot = gravity.gx * boundary.absorbGx + gravity.gy * boundary.absorbGy
	if (!boundary.regurgitating && boundary.absorbedUnits > 0.05 && absorbDot < REGURG_DOT) {
		boundary.regurgitating = true
		boundary.regurgitatedUnits = 0
		boundary.regurgitatedHeat = 0
		boundary.regurgitatePhase = 0
	}

	if (!boundary.regurgitating || boundary.absorbedUnits <= 0) return

	const remainU = boundary.absorbedUnits - boundary.regurgitatedUnits
	const remainH = boundary.absorbedHeat - boundary.regurgitatedHeat
	if (remainU <= 0.02) {
		boundary.regurgitating = false
		boundary.absorbedUnits = 0
		boundary.absorbedHeat = 0
		boundary.regurgitatedUnits = 0
		boundary.regurgitatedHeat = 0
		boundary.regurgitatePhase = 0
		return
	}

	const phase = 1 - remainU / boundary.absorbedUnits
	boundary.regurgitatePhase = phase
	const absorbedAvg = boundary.absorbedHeat / boundary.absorbedUnits
	const tOut = regurgitateTemp(absorbedAvg, phase)
	const avgRemain = remainH / remainU
	const targetT = (tOut + avgRemain) * 0.5
	let budget = Math.min(REGURG_RATE, remainU)

	/** @type {number[]} */
	const cells = []
	for (let e = 0; e < 4; e++) {
		if (budget <= 1e-6) break
		if (roles[e].source < 0.15) continue
		collectEdgeCells(world, e, cells)
		for (const cell of cells) {
			if (budget <= 1e-6) break
			const take = Math.min(budget, LAVA_INJECT) * roles[e].source
			if (take <= 1e-6) continue
			const x = cell % W
			const y = (cell / W) | 0
			const stored = addMelt(world, x, y, take, targetT)
			if (stored <= 1e-6) continue
			boundary.regurgitatedUnits += stored
			boundary.regurgitatedHeat += stored * targetT
			budget -= stored
		}
	}
}

/**
 * 边界步进：曝露积分、岩浆、吸收/回吐。
 * @param {FluidWorld} world 世界
 * @returns {void}
 */
export const stepBoundary = (world) => {
	const roles = edgeRoles(world)
	accumulateExposure(world, roles)
	stepEdgeExchange(world, roles)
	stepRegurgitation(world, roles)
}
