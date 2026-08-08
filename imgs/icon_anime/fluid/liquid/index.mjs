/**
 * 液体步进编排：水 → 土壤 → 水力均衡 → 熔岩 → 熔岩水力 → 浮力。
 *
 * 水相：静压柱特化（`pressure.mjs` + `water.mjs`）。
 * 熔岩：粘滞 Stokes 共用核（`transport.mjs`）+ 独立 φ 松弛。
 * φ 松弛使用独立流缓冲，不写入 liqV（避免准静态均衡被惯性回馈放大）。
 */

import { viscGain } from '../flow.mjs'
import { SUBSTANCE, rhoOf, viscOf } from '../mat.mjs'
import { stepSoil } from '../soil.mjs'
import { scratch, fillCellDepths, buildDepthOrder } from '../world.mjs'

import { equilibrateHydraulic, equilibrateMeltHydraulic } from './hydraulic.mjs'
import { stepLava, stepBuoyancy, meltVisc } from './lava.mjs'
import { liquidPressureAt, condensedPressureAt } from './pressure.mjs'
import { stepWater, commitWaterVelocity, WATER_VISC } from './water.mjs'

/** @typedef {import('../world.mjs').FluidWorld} FluidWorld */

/** 熔岩 φ 松弛代表迁移率（中温岩粘滞）。 */
const MELT_HYDRO_MOBILITY = Math.max(0.05, viscGain(viscOf(rhoOf(SUBSTANCE.ROCK, 0.7))))

/**
 * 自由水静压、熔岩粘滞与液体步进。
 */
export { liquidPressureAt, condensedPressureAt, meltVisc, stepLava, WATER_VISC }

/**
 * 推进自由水 + 熔岩一个 tick。
 * @param {FluidWorld} world 流体世界
 * @returns {void}
 */
export const stepLiquid = (world) => {
	const { flowX, flowY } = stepWater(world)
	stepSoil(world)
	// Commit transport velocities before φ relax so inertia cannot amplify hydrostatic equalize.
	commitWaterVelocity(world, flowX, flowY)

	const n = world.worldW * world.worldH
	const hydroX = scratch(world, 'liqHydroFlowX', n, Float32Array)
	const hydroY = scratch(world, 'liqHydroFlowY', n, Float32Array)
	hydroX.fill(0)
	hydroY.fill(0)
	equilibrateHydraulic(world, hydroX, hydroY)

	const depth = fillCellDepths(world)
	const deepOrder = buildDepthOrder(world, 'liqDeepOrder', 'liqDeepCounts', true, depth)
	const shared = { depth, order: deepOrder }
	stepLava(world, shared)

	const meltFlowX = scratch(world, 'meltHydroFlowX', n, Float32Array)
	const meltFlowY = scratch(world, 'meltHydroFlowY', n, Float32Array)
	meltFlowX.fill(0)
	meltFlowY.fill(0)
	equilibrateMeltHydraulic(world, meltFlowX, meltFlowY, MELT_HYDRO_MOBILITY)

	stepBuoyancy(world, shared)
}
