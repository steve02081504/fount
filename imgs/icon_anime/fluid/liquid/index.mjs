/**
 * 液体步进编排：水 → 土壤 → 水力均衡 → 熔岩 → 熔岩水力 → 浮力。
 *
 * 水相：静压柱特化（`pressure.mjs` + `water.mjs`）。
 * 熔岩：粘滞 Stokes 共用核（`transport.mjs`）+ 独立 φ 松弛。
 * φ 松弛使用独立流缓冲，不写入 liqV（避免准静态均衡被惯性回馈放大）。
 */

import { viscGain } from '../flow.mjs'
import { labelAirRegions } from '../gas/index.mjs'
import { SUBSTANCE, rhoOf, viscOf } from '../mat.mjs'
import { stepSoil } from '../soil.mjs'
import { meltVisc } from '../thermal.mjs'
import { scratch, fillCellDepths } from '../world/index.mjs'

import { equilibrateHydraulic, equilibrateMeltHydraulic } from './hydraulic.mjs'
import { stepLava, stepBuoyancy } from './lava.mjs'
import { liquidPressureAt, condensedPressureAt } from './pressure.mjs'
import { stepWater, commitWaterVelocity, WATER_VISC } from './water.mjs'

/** @typedef {import('../world/index.mjs').FluidWorld} FluidWorld */

/**
 * 自由水静压、熔岩粘滞与液体步进。
 */
export { liquidPressureAt, condensedPressureAt, meltVisc, stepLava, WATER_VISC }

/**
 * 推进自由水 + 熔岩一个 tick。
 * 粒子 / 抬升可能再次弄脏空气拓扑，故在水步进前按需重标气区。
 * @param {FluidWorld} world 流体世界
 * @returns {void}
 */
export const stepLiquid = (world) => {
	if (world.airDirty) labelAirRegions(world)
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
	// Deep order built once in beginLiquidPressure (shared with water settle).
	const deepOrder = /** @type {Int32Array} */ world.scratch.liqDeepOrder
	const shared = { depth, order: deepOrder }
	stepLava(world, shared)

	const meltFlowX = scratch(world, 'meltHydroFlowX', n, Float32Array)
	const meltFlowY = scratch(world, 'meltHydroFlowY', n, Float32Array)
	meltFlowX.fill(0)
	meltFlowY.fill(0)
	equilibrateMeltHydraulic(
		world, meltFlowX, meltFlowY,
		Math.max(0.05, viscGain(viscOf(rhoOf(SUBSTANCE.ROCK, 0.7)))),
	)

	stepBuoyancy(world, shared)
}
