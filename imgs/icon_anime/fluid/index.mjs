/**
 * Particle / grid-liquid / gas-flow engine for ASCII scenes.
 *
 * Air regions carry conserved gas mass; sealed cavities follow isothermal Boyle.
 * Open air carries a velocity field with height shear + nozzle continuity.
 * Communicating vessels equalize φ = P/(ρg) - surfaceY.
 * Soil stores moisture; seepage feeds underside condensation that drips.
 */

/**
 *
 */
export {
	MAT, P_ATM, RHO_G,
	SOIL_CAP, SOIL_ABSORB_RATE, SOIL_ABSORB_EXPO, SOIL_HIT_ABSORB_FRAC,
	SOIL_SIDE_FRAC, SOIL_DOWN_FRAC, SOIL_CONDENSE_FRAC,
	COND_DRAW, COND_DRIP, COND_MATTHEW_RATE, COND_MATTHEW_NOISE,
	LIQ_DRAW, LIQ_FULL,
	isSolidMat, isSoilMat, isBlockMat, isLiquidBarrier, soilAbsorbFactor,
} from './mat.mjs'

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
	setMat, addMoisture, addLiquid, totalGridWater,
} from './world.mjs'

/**
 *
 */
export {
	WIND_BASE, WIND_GUST, WIND_SHEAR_POWER, GAS_BLEND, GAS_NOZZLE,
	labelAirRegions, pressureAt, globalWindAt, windProfileAt,
	gasVelocityAt, dynamicPressure, staticPressureAt, stepGas, totalSealedGas,
} from './gas.mjs'

/**
 *
 */
export { labelLiquidSurfaces, stepSoil, stepLiquid } from './liquid.mjs'

/**
 *
 */
export {
	GAS_DRAG, GAS_DRAG_Y, spawnParticle, queueSplash, stepParticles,
} from './particles.mjs'

/**
 *
 */
export { hash01 } from '../hash.mjs'
