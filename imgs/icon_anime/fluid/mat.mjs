/** Material enum. */
export const MAT = {
	AIR: 0,
	SOLID: 1,
	SLOPE_L: 2,
	SLOPE_R: 3,
	HORIZON: 4,
	POOL: 5,
	BODY: 6,
	/** Impermeable barrier — no moisture / seepage (tests & sealed vessels). */
	SEAL: 7,
}

/** Material classification bits — one LUT lookup instead of multi-branch compares. */
const MF_SOLID = 1
const MF_SOIL = 2
const MF_BLOCK = 4
const MF_LIQ_BARRIER = 8
const MAT_FLAGS = new Uint8Array([
	0, // AIR
	MF_SOLID | MF_SOIL | MF_BLOCK | MF_LIQ_BARRIER, // SOLID
	MF_SOLID | MF_BLOCK | MF_LIQ_BARRIER, // SLOPE_L
	MF_SOLID | MF_BLOCK | MF_LIQ_BARRIER, // SLOPE_R
	MF_SOLID | MF_SOIL | MF_BLOCK | MF_LIQ_BARRIER, // HORIZON
	MF_BLOCK, // POOL
	MF_BLOCK | MF_LIQ_BARRIER, // BODY
	MF_SOLID | MF_BLOCK | MF_LIQ_BARRIER, // SEAL
])

/** Atmospheric reference pressure. */
export const P_ATM = 1

/** Liquid density × gravity scale for hydraulic φ. */
export const RHO_G = 1

/** Max moisture a soil cell can hold. */
export const SOIL_CAP = 1
/** Peak free-liquid absorb rate into dry soil, per tick. */
export const SOIL_ABSORB_RATE = 0.015
/** Absorb rate falls as `(1 - wetness) ** expo`. */
export const SOIL_ABSORB_EXPO = 1.8
/** Max fraction of a rain/impact hit absorbed into dry soil. */
export const SOIL_HIT_ABSORB_FRAC = 0.3
/** Fraction of moisture shared laterally. */
export const SOIL_SIDE_FRAC = 0.04
/** Fraction of moisture transferred into soil below. */
export const SOIL_DOWN_FRAC = 0.06
/** Fraction of moisture fed into underside condensation when below is air. */
export const SOIL_CONDENSE_FRAC = 0.06
/** Condensation amount that draws as a hanging droplet. */
export const COND_DRAW = 0.35
/** Condensation amount that drips into free liquid below. */
export const COND_DRIP = 0.85
/** Lateral Matthew transfer rate between neighboring condensation cells. */
export const COND_MATTHEW_RATE = 0.22
/** Noise amplitude (fraction of pair mass) to break condensation ties. */
export const COND_MATTHEW_NOISE = 0.4

/** Free-liquid draw / air-region occupancy threshold. */
export const LIQ_DRAW = 0.35

/** Max free-liquid amount per cell. */
export const LIQ_FULL = 1

/**
 * Whether the material is solid-like (terrain / slope / seal).
 * @param {number} m material id
 * @returns {boolean} solid-like
 */
export const isSolidMat = m => !!(MAT_FLAGS[m] & MF_SOLID)

/**
 * Whether the material stores soil moisture (HORIZON / SOLID).
 * @param {number} m material id
 * @returns {boolean} soil
 */
export const isSoilMat = m => !!(MAT_FLAGS[m] & MF_SOIL)

/**
 * Whether the material blocks gas flood-fill / region labeling.
 * @param {number} m material id
 * @returns {boolean} gas/flood block
 */
export const isBlockMat = m => !!(MAT_FLAGS[m] & MF_BLOCK)

/**
 * Whether free liquid cannot occupy the cell (solids + BODY).
 * @param {number} m material id
 * @returns {boolean} liquid barrier
 */
export const isLiquidBarrier = m => !!(MAT_FLAGS[m] & MF_LIQ_BARRIER)

/**
 * Dry-soil absorb factor in [0, 1] — full when empty, →0 as moisture fills.
 * @param {number} moisture current moisture
 * @returns {number} factor
 */
export const soilAbsorbFactor = moisture =>
	(1 - Math.min(1, Math.max(0, moisture / SOIL_CAP))) ** SOIL_ABSORB_EXPO
