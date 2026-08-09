/**
 * 流体世界网格：材质、液体、熔岩、温度、土壤水、气体速度、粒子、重力。
 */

/**
 *
 */
export {
	createWorld, scratch, growScratch, floodClear, floodPush, idx, inWorld,
	clearDynamics, clearMaterials,
} from './create.mjs'

/**
 *
 */
export {
	markAirIfDrawCrossed, markAirIfMeltDrawCrossed, markAirIfFillCrossed,
	releaseNonSoilWater, setMat, addMoisture, addLiquid, addMelt,
	totalGridWater, totalWorldWater, totalMelt,
	cellFill, cellRoom, isCondensed, impartLiquidMomentum,
} from './cells.mjs'

/**
 *
 */
export {
	gravityDepth, fillCellDepths, buildDepthOrders, buildDepthOrder,
	gravityDownWeights, gravitySettleWeights, gravityUpWeights, gravitySideWeights,
	strongestUp, strongestDown, isLiquidFreeSurface, applyGravityToWorld,
} from './depth.mjs'

/** @typedef {import('./create.mjs').FluidWorld} FluidWorld */
