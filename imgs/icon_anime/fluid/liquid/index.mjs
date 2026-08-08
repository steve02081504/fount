/**
 * 液体步进编排：水 → 土壤 → 水力均衡 → 熔岩 → 浮力。
 *
 * 水相：静压柱特化（`pressure.mjs` + `water.mjs`）。
 * 熔岩：粘滞 Stokes 共用核（`transport.mjs`）。
 */

import { stepSoil } from '../soil.mjs'
import { fillCellDepths, buildDepthOrder } from '../world.mjs'

import { equilibrateHydraulic } from './hydraulic.mjs'
import { stepLava, stepBuoyancy, meltVisc } from './lava.mjs'
import { liquidPressureAt } from './pressure.mjs'
import { stepWater, commitWaterVelocity, WATER_VISC } from './water.mjs'

/** @typedef {import('../world.mjs').FluidWorld} FluidWorld */

/**
 * 自由水静压、熔岩粘滞与液体步进。
 */
export { liquidPressureAt, meltVisc, stepLava, WATER_VISC }

/**
 * 推进自由水 + 熔岩一个 tick。
 * @param {FluidWorld} world 流体世界
 * @returns {void}
 */
export const stepLiquid = (world) => {
	const { flowX, flowY } = stepWater(world)
	stepSoil(world)
	equilibrateHydraulic(world, flowX, flowY)
	const depth = fillCellDepths(world)
	const deepOrder = buildDepthOrder(world, 'liqDeepOrder', 'liqDeepCounts', true, depth)
	const shared = { depth, order: deepOrder }
	stepLava(world, shared)
	stepBuoyancy(world, shared)
	commitWaterVelocity(world, flowX, flowY)
}
