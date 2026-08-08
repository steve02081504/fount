/**
 * ASCII 场景的粒子 / 网格液体 / 气流 / 熔岩引擎。
 *
 * 统一压强模型：
 *   气体热力学 — 开放：P_ATM + ATM_HYDRO·depth；密封：等温 Boyle + 静水
 *   液体       — P_air(表面) + RHO_G·深度；质量 ∝ √(ΔP/ρg)（Torricelli）
 *   气体动态   — 伯努利 P−½ρu² 驱动 ΔP 加速
 *   容器       — φ = P/(ρg)−depth 沿液体图均衡（无瞬移）
 *
 * 统一密度语言：rhoOf(substance, temp) → viscOf(rho)；粘滞阶梯选惯性/Stokes/冻结。
 *
 * 水库：liq + moisture + condense + particles（过期沉积）+ melt。
 * 完整 tick 调用 `stepFluid`。
 */

/** 材质枚举与土壤/液体/热力常量。 */
export {
	MAT, P_ATM, RHO_G, RHO_AIR, ATM_HYDRO, GAS_DP_DRIVE,
	SOIL_CAP, SOIL_ABSORB_RATE, SOIL_ABSORB_EXPO, SOIL_HIT_ABSORB_FRAC,
	SOIL_SIDE_FRAC, SOIL_DOWN_FRAC, SOIL_CONDENSE_FRAC,
	COND_DRAW, COND_DRIP, COND_WEEP_FRAC, COND_MATTHEW_RATE, COND_MATTHEW_NOISE,
	LIQ_DRAW, LIQ_FULL,
	T_AMB, T_SOLIDUS, T_LIQUIDUS, T_BOIL, T_MAX,
	RHO_ROCK, RHO_LAVA_HOT, VISC_SOLID, VISC_INERTIAL, BUBBLE_MIN_CELLS, BUBBLE_MIN_MELT_CONTACT,
	LAVA_ONSET_EXPOSURE,
	SUBSTANCE, rhoOf, viscOf, isViscSolid,
	isSoilMat, isBlockMat, isLiquidBarrier, soilAbsorbFactor,
} from './mat.mjs'

/** 压强驱动质量传递原语。 */
export {
	P_FLOW_CAP, P_FLOW_GAIN, SHEET_GAIN, viscGain, isInertialVisc,
	hydraulicPhi, pressureMove, sheetMove, applyTransfer,
} from './flow.mjs'

/** 液体/水滴/熔岩字形集。 */
export {
	FALL_HEAVY, STILL_SPEED, SLANT_SPEED, FLAT_RATIO, HIGH_MOMENTUM, HIGH_SPEED,
	WATER_HIGH_L, WATER_HIGH_R, WATER_LOW_DL, WATER_LOW_DR, WATER_FALL, WATER_STILL,
	pickWaterGlyph, waterChar, liquidChar, dripChar, lavaChar,
} from './glyphs.mjs'

/** 流体世界网格与材质 API。 */
export {
	createWorld, scratch, growScratch, idx, inWorld,
	floodClear, floodPush, markAirIfDrawCrossed, markAirIfMeltDrawCrossed,
	clearDynamics, clearMaterials, releaseNonSoilWater,
	setMat, addMoisture, addLiquid, addMelt, totalGridWater, totalWorldWater, totalMelt,
	gravityDepth, gravityDownWeights, gravityUpWeights, strongestUp, strongestDown, applyGravityToWorld,
} from './world.mjs'

/** 气相区域、压力与风速。 */
export {
	WIND_BASE, WIND_GUST, WIND_SHEAR_POWER, GAS_BLEND, GAS_NOZZLE, GAS_SPEED_MAX,
	isAirCell, fillBlocked, labelAirRegions, pressureAt, globalWindAt, windShear,
	gasVelocityAt, gasUxAt, dynamicPressure, staticPressureAt, stepGas, totalSealedGas,
} from './gas.mjs'

/** 土壤湿度 / 凝结 / 滴落。 */
export { stepSoil, condenseDripSource } from './soil.mjs'

/** 热力与相变。 */
export { stepThermal, cellRho } from './thermal.mjs'

/** 分数边角色与邻格环绕。 */
export {
	neighborCoord, edgeRoles, edgeDownness, edgeUpness,
	EDGE_TOP, EDGE_BOTTOM, EDGE_LEFT, EDGE_RIGHT,
} from './edges.mjs'

/** 边界曝露、岩浆与回吐。 */
export { regurgitateTemp, stepBoundary } from './boundary.mjs'

/** 气泡。 */
export { stepBubbles } from './bubbles.mjs'

/** 自由液体静压与步进。 */
export { liquidPressureAt, stepLiquid } from './liquid/index.mjs'

/** 熔岩粘滞与输运特化。 */
export { meltVisc, stepLava } from './liquid/lava.mjs'

/** 水相粘滞。 */
export { WATER_VISC } from './liquid/water.mjs'

/** 粒子池。 */
export {
	createParticlePool, clearParticlePool, totalParticleWater, pushParticle, PARTICLE_CAP,
} from './particle_pool.mjs'

/** 粒子雨与风抬升。 */
export {
	GAS_DRAG, GAS_DRAG_Y, GAS_DRAG_Y_BOOST_FROM, GAS_DRAG_Y_BOOST_SPAN,
	WIND_LIFT_UY, WIND_LIFT_RATE, WIND_LIFT_MAX, WIND_HOLD_LIFE, PARTICLE_GRAVITY,
	verticalGasDrag,
	spawnParticle, queueSplash, depositParticleMass, stepParticles, liftLiquidByWind,
} from './particles.mjs'

/** 单 tick 流体编排入口。 */
export { stepFluid, stepResizeWeather } from './step.mjs'
