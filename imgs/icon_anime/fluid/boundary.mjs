/**
 * 重力相对边界：下边岩浆源、上边雨/岩浆汇与回吐、垂直轴等高环绕。
 */

import {
	MAT, LIQ_FULL, T_MAX, T_AMB, LAVA_ONSET_FRAMES, isLiquidBarrier,
} from './mat.mjs'
import { markAirIfDrawCrossed, markAirIfMeltDrawCrossed, addMelt } from './world.mjs'
import { onUpEdge } from './edges.mjs'

/** @typedef {import('./world.mjs').FluidWorld} FluidWorld */

/** 下边每 tick 注入熔岩质量。 */
const LAVA_INJECT = 0.35
/** 上边回吐每 tick 质量上限。 */
const REGURG_RATE = 0.4

export { boundaryAxes, wrapSide, neighborCoord, onDownEdge, onUpEdge } from './edges.mjs'

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
 * 边界步进：下边岩浆、上边累计/回吐、贴边恒温。
 * @param {FluidWorld} world 世界
 * @returns {void}
 */
export const stepBoundary = (world) => {
	const { worldW: W, worldH: H, mat, liq, melt, temp, gravity, boundary } = world
	const wasNormal = gravity.normalFrames > 0
	const lavaOn = gravity.normalFrames >= LAVA_ONSET_FRAMES

	// Start regurgitation when gravity returns to screen-down with backlog.
	if (wasNormal && gravity.normalFrames === 1 && boundary.absorbedUnits > 0.05) {
		boundary.regurgitating = true
		boundary.regurgitatedUnits = 0
		boundary.regurgitatedHeat = 0
		boundary.regurgitatePhase = 0
	}

	const { axis, sign } = gravity

	/** @type {number[]} */
	const downCells = []
	/** @type {number[]} */
	const upCells = []

	if (axis === 1) {
		const y = sign > 0 ? H - 1 : 0
		for (let x = 0; x < W; x++) downCells.push(y * W + x)
		const uy = sign > 0 ? 0 : H - 1
		for (let x = 0; x < W; x++) upCells.push(uy * W + x)
	}
	else {
		const x = sign > 0 ? W - 1 : 0
		for (let y = 0; y < H; y++) downCells.push(y * W + x)
		const ux = sign > 0 ? 0 : W - 1
		for (let y = 0; y < H; y++) upCells.push(y * W + ux)
	}

	// Down edge: infinite lava source + clamp temp; wipe water (no count).
	if (lavaOn)
		for (const cell of downCells) {
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
			melt[cell] = Math.min(LIQ_FULL, Math.max(melt[cell], LAVA_INJECT))
			temp[cell] = T_MAX
			markAirIfMeltDrawCrossed(world, before, melt[cell])
		}
	else
		for (const cell of downCells) {
			// Still wipe free liquid on down edge (old bottom-row sink).
			const before = liq[cell]
			if (before > 0) {
				liq[cell] = 0
				markAirIfDrawCrossed(world, before, 0)
			}
		}

	// Always clamp existing melt on down edge to T_MAX once lava era started.
	if (lavaOn)
		for (const cell of downCells)
			if (melt[cell] > 0.02) temp[cell] = T_MAX

	// Up edge: absorb melt into counter; regurgitate when active.
	for (const cell of upCells) {
		if (melt[cell] > 0.02 && !boundary.regurgitating) {
			const take = melt[cell]
			boundary.absorbedUnits += take
			boundary.absorbedHeat += take * temp[cell]
			boundary.lastTemp = temp[cell]
			melt[cell] = 0
			markAirIfMeltDrawCrossed(world, take, 0)
			temp[cell] = T_AMB
		}
		const beforeL = liq[cell]
		if (beforeL > 0 && onUpEdge(world, cell % W, (cell / W) | 0)) {
			// Rain is infinite from sky — free liquid at up edge is not counted; leave particles to spawn.
		}
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
			for (const cell of upCells) {
				if (budget <= 1e-6) break
				if (isLiquidBarrier(mat[cell]) && mat[cell] !== MAT.AIR) continue
				const room = LIQ_FULL - melt[cell]
				if (room <= 0) continue
				const take = Math.min(budget, room, LAVA_INJECT)
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
