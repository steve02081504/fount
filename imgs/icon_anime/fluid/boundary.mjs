/**
 * 重力相对边界：分数边角色 + 做功积分曝露。
 * 下向边累积 exposure → 岩浆源；上向边出雨/吸收与回吐。
 */

import {
	MAT, LIQ_FULL, T_MAX, T_AMB, LAVA_ONSET_EXPOSURE, isLiquidBarrier,
} from './mat.mjs'
import { markAirIfDrawCrossed, markAirIfMeltDrawCrossed, addMelt } from './world.mjs'
import {
	edgeRoles, EDGE_TOP, EDGE_BOTTOM, EDGE_LEFT, EDGE_RIGHT,
} from './edges.mjs'

/** @typedef {import('./world.mjs').FluidWorld} FluidWorld */

/** 下边每 tick 注入熔岩质量（满 sink 权重时）。 */
const LAVA_INJECT = 0.35
/** 上边回吐每 tick 质量上限。 */
const REGURG_RATE = 0.4
/** 回吐触发：ĝ·absorbDir 低于此值。 */
const REGURG_DOT = 0.35

export {
	boundaryAxes, wrapSide, neighborCoord, onDownEdge, onUpEdge,
	edgeRoles, edgeDownness, edgeUpness,
	EDGE_TOP, EDGE_BOTTOM, EDGE_LEFT, EDGE_RIGHT,
} from './edges.mjs'

/**
 * 回吐温度剖面：先增后减，以 lastTemp 为起点。
 * @param {number} lastTemp 起点温度
 * @param {number} phase [0, 1] 进度
 * @returns {number} 温度
 */
export const regurgitateTemp = (lastTemp, phase) => {
	const p = Math.min(1, Math.max(0, phase))
	const peak = Math.min(T_MAX, lastTemp + (T_MAX - lastTemp) * 0.55)
	if (p < 0.5) {
		const t = p * 2
		return lastTemp + (peak - lastTemp) * t
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
 * 边界步进：曝露积分、岩浆、吸收/回吐。
 * @param {FluidWorld} world 世界
 * @returns {void}
 */
export const stepBoundary = (world) => {
	const { worldW: W, mat, liq, melt, temp, gravity, boundary } = world
	const roles = edgeRoles(world)
	const exposure = boundary.exposure

	// Accumulate work on each edge; decay when flipped.
	for (let e = 0; e < 4; e++) {
		const delta = roles[e].nx * gravity.gx + roles[e].ny * gravity.gy
		exposure[e] = Math.max(0, exposure[e] + delta)
	}

	/** @type {number[]} */
	const cells = []

	for (let e = 0; e < 4; e++) {
		const sink = roles[e].sink
		const source = roles[e].source
		if (sink < 0.05 && source < 0.05) continue
		collectEdgeCells(world, e, cells)

		const lavaOn = exposure[e] >= LAVA_ONSET_EXPOSURE && sink > 0.05
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
				const before = melt[cell]
				melt[cell] = Math.min(LIQ_FULL, Math.max(melt[cell], inject))
				temp[cell] = T_MAX
				markAirIfMeltDrawCrossed(world, before, melt[cell])
			}
		}
		else if (sink > 0.15) {
			for (const cell of cells) {
				const before = liq[cell]
				if (before > 0) {
					liq[cell] = 0
					markAirIfDrawCrossed(world, before, 0)
				}
			}
		}

		if (lavaOn)
			for (const cell of cells)
				if (melt[cell] > 0.02) temp[cell] = T_MAX

		// Up-edge absorb when source-weighted.
		if (source > 0.15 && !boundary.regurgitating)
			for (const cell of cells) {
				if (melt[cell] > 0.02) {
					const take = melt[cell] * source
					boundary.absorbedUnits += take
					boundary.absorbedHeat += take * temp[cell]
					boundary.lastTemp = temp[cell]
					// Remember gravity orientation at absorb time; regurgitate when it leaves.
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

	// Regurgitate when gravity leaves the absorb direction.
	const absorbDot = gravity.gx * boundary.absorbGx + gravity.gy * boundary.absorbGy
	if (!boundary.regurgitating && boundary.absorbedUnits > 0.05 && absorbDot < REGURG_DOT) {
		boundary.regurgitating = true
		boundary.regurgitatedUnits = 0
		boundary.regurgitatedHeat = 0
		boundary.regurgitatePhase = 0
	}

	if (boundary.regurgitating && boundary.absorbedUnits > 0) {
		const remainU = boundary.absorbedUnits - boundary.regurgitatedUnits
		const remainH = boundary.absorbedHeat - boundary.regurgitatedHeat
		if (remainU <= 0.02) {
			boundary.regurgitating = false
			boundary.absorbedUnits = 0
			boundary.absorbedHeat = 0
			boundary.regurgitatedUnits = 0
			boundary.regurgitatedHeat = 0
			boundary.regurgitatePhase = 0
		}
		else {
			const phase = 1 - remainU / boundary.absorbedUnits
			boundary.regurgitatePhase = phase
			const tOut = regurgitateTemp(boundary.lastTemp, phase)
			const avgRemain = remainH / remainU
			const targetT = (tOut + avgRemain) * 0.5
			let budget = Math.min(REGURG_RATE, remainU)

			// Prefer current sky edges (source-weighted).
			for (let e = 0; e < 4; e++) {
				if (budget <= 1e-6) break
				if (roles[e].source < 0.15) continue
				collectEdgeCells(world, e, cells)
				for (const cell of cells) {
					if (budget <= 1e-6) break
					if (isLiquidBarrier(mat[cell]) && mat[cell] !== MAT.AIR) continue
					const room = LIQ_FULL - melt[cell]
					if (room <= 0) continue
					const take = Math.min(budget, room, LAVA_INJECT) * roles[e].source
					if (take <= 1e-6) continue
					const x = cell % W
					const y = (cell / W) | 0
					addMelt(world, x, y, take, targetT)
					boundary.regurgitatedUnits += take
					boundary.regurgitatedHeat += take * targetT
					budget -= take
				}
			}
		}
	}
}
