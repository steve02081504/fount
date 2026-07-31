/**
 * ASCII 场景的粒子 / 网格液体 / 气流引擎。
 *
 * 统一压强模型：
 *   气体热力学 — 开放：P_ATM + ATM_HYDRO·y；密封：等温 Boyle + 静水
 *   液体       — P_air(表面) + RHO_G·深度；质量 ∝ √(ΔP/ρg)（Torricelli）
 *   气体动态   — 伯努利 P−½ρu² 驱动 ΔP 加速；软 ∇·u 投影
 *   容器       — φ = P/(ρg)−y 沿液体图均衡（无瞬移）
 *
 * 水库：liq + moisture + condense + particles（过期沉积）。
 * 完整 tick 调用 `stepFluid`，或单独调用各子步。`labelAirRegions`
 * 在 `airDirty`（材质 / LIQ_DRAW 占用）时运行；若粒子 / 抬升再次弄脏拓扑，
 * `stepLiquid` 于 tick 中途重新标记。
 */

/** 材质枚举与土壤/液体常量。 */
export {
	MAT, P_ATM, RHO_G, RHO_AIR, ATM_HYDRO, GAS_DP_DRIVE,
	SOIL_CAP, SOIL_ABSORB_RATE, SOIL_ABSORB_EXPO, SOIL_HIT_ABSORB_FRAC,
	SOIL_SIDE_FRAC, SOIL_DOWN_FRAC, SOIL_CONDENSE_FRAC,
	COND_DRAW, COND_DRIP, COND_MATTHEW_RATE, COND_MATTHEW_NOISE,
	LIQ_DRAW, LIQ_FULL,
	isSoilMat, isBlockMat, isLiquidBarrier, soilAbsorbFactor,
} from './mat.mjs'

/** 压强驱动质量传递原语。 */
export {
	P_FLOW_CAP, P_FLOW_GAIN, SHEET_GAIN,
	hydraulicPhi, pressureMove, sheetMove, applyTransfer,
} from './flow.mjs'

/** 液体/水滴字形集。 */
export {
	FALL_HEAVY, STILL_SPEED, SLANT_SPEED, FLAT_RATIO, HIGH_MOMENTUM, HIGH_SPEED,
	WATER_HIGH_L, WATER_HIGH_R, WATER_LOW_DL, WATER_LOW_DR, WATER_FALL, WATER_STILL,
	pickWaterGlyph, waterChar, liquidChar, dripChar,
} from './glyphs.mjs'

/** 流体世界网格与材质 API。 */
export {
	createWorld, scratch, growScratch, idx, inWorld,
	floodClear, floodPush, markAirIfDrawCrossed,
	clearDynamics, clearMaterials, releaseNonSoilWater,
	setMat, addMoisture, addLiquid, totalGridWater, totalWorldWater,
} from './world.mjs'

/** 气相区域、压力与风速。 */
export {
	WIND_BASE, WIND_GUST, WIND_SHEAR_POWER, GAS_BLEND, GAS_NOZZLE, GAS_SPEED_MAX,
	isAirCell, fillBlocked, labelAirRegions, pressureAt, globalWindAt, windProfileAt,
	gasVelocityAt, gasUxAt, dynamicPressure, staticPressureAt, stepGas, totalSealedGas,
} from './gas.mjs'

/** 土壤湿度 / 凝结 / 滴落。 */
export { stepSoil } from './soil.mjs'

/** 自由液体静压与步进。 */
export { liquidPressureAt, stepLiquid } from './liquid.mjs'

/** 粒子雨与风抬升。 */
export {
	GAS_DRAG, GAS_DRAG_Y, GAS_DRAG_Y_BOOST_FROM, GAS_DRAG_Y_BOOST_SPAN,
	WIND_LIFT_UY, WIND_LIFT_RATE, WIND_LIFT_MAX, WIND_HOLD_LIFE,
	verticalGasDrag, createParticlePool, clearParticlePool, totalParticleWater,
	spawnParticle, queueSplash, depositParticleMass, stepParticles, liftLiquidByWind,
} from './particles.mjs'

/** 单 tick 流体编排入口。 */
export { stepFluid } from './step.mjs'
