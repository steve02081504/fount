/**
 * 液体步进编排：水 → 土壤 → 水力均衡 → 熔岩 → 浮力。
 *
 * 水 / 熔岩是凝聚相的两种特化；共用核见 `transport.mjs`。
 * 表面张力：自由面薄层对干邻减速（`ST_DRY_FRAC`），湿湿仍走 sheetMove。
 */

import { stepSoil } from '../soil.mjs'
import { equilibrateHydraulic } from './equilibrate.mjs'
import { stepLava, stepBuoyancy } from './lava.mjs'
import { stepWater, commitWaterVelocity, liquidPressureAt } from './water.mjs'

/** @typedef {import('../world.mjs').FluidWorld} FluidWorld */

export { liquidPressureAt }

/**
 * 推进自由水 + 熔岩一个 tick。
 * @param {FluidWorld} world 流体世界
 * @returns {void}
 */
export const stepLiquid = (world) => {
	const { flowX, flowY } = stepWater(world)
	stepSoil(world)
	equilibrateHydraulic(world, flowX, flowY, 1)
	stepLava(world)
	stepBuoyancy(world)
	commitWaterVelocity(world, flowX, flowY)
}
