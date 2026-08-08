/**
 * 热力学气压、静压与动压查询。
 * 调用方须在查询前先执行 `labelAirRegions`。
 */

import { RHO_AIR, isBlockMat } from '../mat.mjs'
import {
	scratch, idx, inWorld, gravityDepth, strongestUp, fillCellDepths, buildDepthOrder,
} from '../world/index.mjs'

import { openHydroPressure, sealedHydroPressure } from './regions.mjs'

/** @typedef {import('../world/index.mjs').FluidWorld} FluidWorld
 * @typedef {import('./regions.mjs').AirRegion} AirRegion
 */

/**
 * 沿 −ĝ 走线查找上覆气区压力。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} depth 当前深度
 * @returns {number} 压力
 */
const pressureAlongUp = (world, x, y, depth) => {
	const up = strongestUp(world)
	if (up.w <= 0) return openHydroPressure(depth)
	let cx = x
	let cy = y
	const maxSteps = Math.max(world.worldW, world.worldH)
	for (let step = 0; step < maxSteps; step++) {
		cx += up.dx
		cy += up.dy
		if (!inWorld(world, cx, cy)) break
		const above = idx(world, cx, cy)
		if (isBlockMat(world.mat[above])) break
		const aboveRid = world.regionId[above]
		if (aboveRid) {
			const region = world.regions[aboveRid]
			const d = gravityDepth(world, cx, cy)
			return region.openToAtm
				? openHydroPressure(d)
				: sealedHydroPressure(region, d, region.yMean)
		}
	}
	return openHydroPressure(depth)
}

/**
 * 热力学气压（无 Bernoulli）：与 `pressureAt` 同式，写入 `thermoP` scratch。
 * 气区标注或重力深度基变化后惰性重建；供液体/熔岩热路径查表。
 * 非气格沿 −ĝ 浅→深传播：上邻已解析到气区则拷贝，否则与 `pressureAlongUp` 同样回退开大气。
 * @param {FluidWorld} world 流体世界
 * @returns {Float32Array} 长度 WH 的热力学压场
 */
export const ensureThermoPressure = (world) => {
	const { worldW: W, worldH: H, regionId, regions, mat } = world
	const n = W * H
	const depth = fillCellDepths(world)
	const airEpoch = /** @type {number} */ (world.scratch.airEpoch) | 0
	const thermoP = scratch(world, 'thermoP', n, Float32Array)
	if (world.scratch.thermoPEpoch === airEpoch) return thermoP

	const up = strongestUp(world)
	const order = buildDepthOrder(world, 'thermoPOrder', 'thermoPCounts', false, depth)
	const resolved = scratch(world, 'thermoResolved', n, Uint8Array)
	for (let si = 0; si < n; si++) {
		const cell = order[si]
		const rid = regionId[cell]
		if (rid) {
			const region = regions[rid]
			const d = depth[cell]
			thermoP[cell] = region.openToAtm
				? openHydroPressure(d)
				: sealedHydroPressure(region, d, region.yMean)
			resolved[cell] = 1
			continue
		}
		if (up.w <= 0) {
			thermoP[cell] = openHydroPressure(depth[cell])
			resolved[cell] = 0
			continue
		}
		const x = cell % W
		const y = (cell / W) | 0
		const ax = x + up.dx
		const ay = y + up.dy
		if (ax < 0 || ay < 0 || ax >= W || ay >= H || isBlockMat(mat[ay * W + ax])) {
			thermoP[cell] = openHydroPressure(depth[cell])
			resolved[cell] = 0
			continue
		}
		const above = ay * W + ax
		if (resolved[above]) {
			thermoP[cell] = thermoP[above]
			resolved[cell] = 1
		}
		else {
			thermoP[cell] = openHydroPressure(depth[cell])
			resolved[cell] = 0
		}
	}
	world.scratch.thermoPEpoch = airEpoch
	return thermoP
}

/**
 * 格的热力学/静压气体压力（无动态 Bernoulli 项）。
 * 开放空气：P_ATM + ATM_HYDRO·depth。
 * 密闭：Boyle 均值 + ATM_HYDRO·(depth − depthMean)，使区平均保持 Boyle。
 * 液体格用上覆空气（或大气压）。
 * @param {FluidWorld} world 流体世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {number} 压力
 */
export const pressureAt = (world, x, y) => {
	if (!inWorld(world, x, y)) {
		const depth = gravityDepth(world, Math.max(0, x), Math.max(0, y))
		return openHydroPressure(Math.max(0, depth))
	}
	const cell = idx(world, x, y)
	const airEpoch = /** @type {number} */ (world.scratch.airEpoch) | 0
	if (world.scratch.thermoPEpoch === airEpoch) {
		const thermoP = /** @type {Float32Array | undefined} */ (world.scratch.thermoP)
		if (thermoP && thermoP.length === world.worldW * world.worldH)
			return thermoP[cell]
	}
	const depth = gravityDepth(world, x, y)
	const rid = world.regionId[cell]
	if (rid) {
		const region = world.regions[rid]
		return region.openToAtm
			? openHydroPressure(depth)
			: sealedHydroPressure(region, depth, region.yMean)
	}
	return pressureAlongUp(world, x, y, depth)
}

/**
 * 动压代理 ½ρu²。
 * @param {number} ux 水平速度
 * @param {number} [uy=0] 垂直速度
 * @returns {number} 动压
 */
export const dynamicPressure = (ux, uy = 0) => 0.5 * RHO_AIR * (ux * ux + uy * uy)

/**
 * Bernoulli 静压：热力学 P − ½ρu²（钳位）。
 * 既作查询，也作 `stepGas` 中驱动邻格 ΔP 的场。
 * @param {FluidWorld} world 流体世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {number} 静压
 */
export const staticPressureAt = (world, x, y) => {
	const cx = x | 0
	const cy = y | 0
	const p = pressureAt(world, x, y)
	if (!inWorld(world, cx, cy)) return Math.max(0.05, p)
	const cell = idx(world, cx, cy)
	return Math.max(0.05, p - dynamicPressure(world.gasUx[cell], world.gasUy[cell]))
}
