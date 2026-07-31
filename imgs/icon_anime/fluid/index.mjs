/**
 * Particle / grid-liquid / gas-flow engine for ASCII scenes.
 *
 * Unified pressure model:
 *   gas thermo  — open: P_ATM + ATM_HYDRO·y; sealed: isothermal Boyle + hydro
 *   liquid      — P_air(surface) + RHO_G·depth; mass ∝ √(ΔP/ρg) (Torricelli)
 *   gas dynamic — Bernoulli P−½ρu² drives ΔP accel; soft ∇·u projection
 *   vessels     — φ = P/(ρg)−y equalizes along the liquid graph (no teleport)
 *
 * Water reservoirs: liq + moisture + condense + particles (expire deposits).
 * Call `stepFluid` for a full tick, or the individual steps. `labelAirRegions`
 * before `stepGas` / pressure queries; `stepLiquid` re-labels after particles.
 */

/**
 *
 */
export {
	MAT, P_ATM, RHO_G, RHO_AIR, ATM_HYDRO, GAS_DP_DRIVE,
	SOIL_CAP, SOIL_ABSORB_RATE, SOIL_ABSORB_EXPO, SOIL_HIT_ABSORB_FRAC,
	SOIL_SIDE_FRAC, SOIL_DOWN_FRAC, SOIL_CONDENSE_FRAC,
	COND_DRAW, COND_DRIP, COND_MATTHEW_RATE, COND_MATTHEW_NOISE,
	LIQ_DRAW, LIQ_FULL,
	isSoilMat, isBlockMat, isLiquidBarrier, soilAbsorbFactor,
} from './mat.mjs'

/**
 *
 */
export {
	P_FLOW_CAP, P_FLOW_GAIN, SHEET_GAIN,
	hydraulicPhi, pressureMove, sheetMove, applyTransfer,
} from './flow.mjs'

/**
 *
 */
export {
	FALL_HEAVY, STILL_SPEED, SLANT_SPEED, FLAT_RATIO, HIGH_MOMENTUM, HIGH_SPEED,
	WATER_HIGH_L, WATER_HIGH_R, WATER_LOW_DL, WATER_LOW_DR, WATER_FALL, WATER_STILL,
	pickWaterGlyph, waterChar, liquidChar, dripChar,
} from './glyphs.mjs'

/**
 *
 */
export {
	createWorld, scratch, growScratch, idx, inWorld,
	clearDynamics, clearMaterials, releaseNonSoilWater,
	setMat, addMoisture, addLiquid, totalGridWater, totalWorldWater,
} from './world.mjs'

/**
 *
 */
export {
	WIND_BASE, WIND_GUST, WIND_SHEAR_POWER, GAS_BLEND, GAS_NOZZLE, GAS_SPEED_MAX,
	isAirCell, fillBlocked, labelAirRegions, pressureAt, globalWindAt, windProfileAt,
	gasVelocityAt, dynamicPressure, staticPressureAt, stepGas, totalSealedGas,
} from './gas.mjs'

/**
 *
 */
export { liquidPressureAt, stepSoil, stepLiquid } from './liquid.mjs'

/**
 *
 */
export {
	GAS_DRAG, GAS_DRAG_Y, GAS_DRAG_Y_BOOST_FROM, GAS_DRAG_Y_BOOST_SPAN,
	WIND_LIFT_UY, WIND_LIFT_RATE, WIND_LIFT_MAX, WIND_HOLD_LIFE,
	verticalGasDrag, createParticlePool, clearParticlePool, totalParticleWater,
	spawnParticle, queueSplash, depositParticleMass, stepParticles, liftLiquidByWind,
} from './particles.mjs'

/**
 *
 */
export { stepFluid } from './step.mjs'
