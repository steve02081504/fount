/**
 * Fluid world grid: materials, liquid, soil water, gas velocity, particles.
 */

import { MAT, SOIL_CAP, LIQ_FULL, isSoilMat, isLiquidBarrier } from './mat.mjs'
import { createParticlePool, clearParticlePool } from './particles.mjs'

/** @typedef {{
 *   viewW: number, viewH: number, worldW: number, worldH: number,
 *   margin: number, ox: number, oy: number,
 *   mat: Uint8Array, liq: Float32Array, moisture: Float32Array, condense: Float32Array,
 *   gasUx: Float32Array, gasUy: Float32Array,
 *   liqVx: Float32Array, liqVy: Float32Array,
 *   regionId: Int32Array,
 *   regions: (import('./gas.mjs').AirRegion | undefined)[],
 *   particles: import('./particles.mjs').ParticlePool,
 *   pendingSplash: import('./particles.mjs').ParticlePool,
 *   soilStep: number, gasTime: number,
 *   scratch: Record<string, unknown>,
 *   floodQ: number[],
 * }} FluidWorld
 */

/**
 * Allocate a fluid world sized for a view rectangle plus margins.
 * @param {{ width: number, height: number, margin?: number, bottomExtra?: number }} [opts] view size
 * @returns {FluidWorld} empty world
 */
export const createWorld = ({ width, height, margin = 24, bottomExtra = 4 } = {}) => {
	const viewW = width
	const viewH = height
	const worldW = viewW + margin * 2
	const worldH = viewH + bottomExtra
	const size = worldW * worldH
	return {
		viewW, viewH, worldW, worldH, margin, ox: margin, oy: 0,
		mat: new Uint8Array(size),
		liq: new Float32Array(size),
		moisture: new Float32Array(size),
		condense: new Float32Array(size),
		gasUx: new Float32Array(size),
		gasUy: new Float32Array(size),
		liqVx: new Float32Array(size),
		liqVy: new Float32Array(size),
		regionId: new Int32Array(size),
		regions: [],
		particles: createParticlePool(),
		pendingSplash: createParticlePool(),
		soilStep: 0,
		gasTime: 0,
		scratch: {},
		floodQ: [],
	}
}

/**
 * Ensure a typed scratch buffer of exact length `n`.
 * @param {FluidWorld} world fluid world
 * @param {string} key scratch slot
 * @param {number} n length
 * @param {typeof Float32Array | typeof Uint8Array | typeof Uint16Array | typeof Int32Array} Ctor typed-array ctor
 * @returns {Float32Array | Uint8Array | Uint16Array | Int32Array} buffer
 */
export const scratch = (world, key, n, Ctor) => {
	let buf = world.scratch[key]
	if (!buf || buf.length !== n) {
		buf = new Ctor(n)
		world.scratch[key] = buf
	}
	return buf
}

/**
 * Grow a typed scratch buffer to at least `need` elements (doubling).
 * @param {FluidWorld} world fluid world
 * @param {string} key scratch slot
 * @param {number} need minimum length
 * @param {typeof Float32Array | typeof Int32Array} Ctor typed-array ctor
 * @returns {Float32Array | Int32Array} buffer
 */
export const growScratch = (world, key, need, Ctor) => {
	const buf = world.scratch[key]
	if (!buf || buf.length < need) {
		const next = new Ctor(Math.max(need, buf ? buf.length * 2 : 256))
		if (buf) next.set(buf)
		world.scratch[key] = next
		return next
	}
	return buf
}

/**
 * Flat index for world cell `(x, y)`.
 * @param {FluidWorld} w world
 * @param {number} x column
 * @param {number} y row
 * @returns {number} index
 */
export const idx = (w, x, y) => y * w.worldW + x

/**
 * Whether `(x, y)` lies inside the world grid.
 * @param {FluidWorld} w world
 * @param {number} x column
 * @param {number} y row
 * @returns {boolean} in bounds
 */
export const inWorld = (w, x, y) =>
	x >= 0 && y >= 0 && x < w.worldW && y < w.worldH

/**
 * Clear liquid, moisture, gas, particles, and region labels.
 * @param {FluidWorld} w world
 * @returns {void}
 */
export const clearDynamics = (w) => {
	w.liq.fill(0)
	w.moisture.fill(0)
	w.condense.fill(0)
	w.gasUx.fill(0)
	w.gasUy.fill(0)
	w.liqVx.fill(0)
	w.liqVy.fill(0)
	clearParticlePool(w.particles)
	clearParticlePool(w.pendingSplash)
	w.regionId.fill(0)
	w.regions.length = 0
	w.gasTime = 0
}

/**
 * Clear material labels only — moisture/condense persist across rebuilds.
 * @param {FluidWorld} w world
 * @returns {void}
 */
export const clearMaterials = (w) => {
	w.mat.fill(MAT.AIR)
}

/**
 * Dump moisture/condense from non-soil cells into free liquid (or the cell above).
 * @param {FluidWorld} w world
 * @returns {void}
 */
export const releaseNonSoilWater = (w) => {
	const { worldW: W, worldH: H, mat, liq, moisture, condense } = w
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			if (isSoilMat(mat[i])) continue
			const held = moisture[i] + condense[i]
			moisture[i] = 0
			condense[i] = 0
			if (held <= 0) continue
			if (mat[i] === MAT.POOL || mat[i] === MAT.AIR) {
				liq[i] = Math.min(LIQ_FULL, liq[i] + held)
				continue
			}
			if (y > 0 && !isLiquidBarrier(mat[(y - 1) * W + x])) {
				const ai = (y - 1) * W + x
				liq[ai] = Math.min(LIQ_FULL, liq[ai] + held)
			}
		}
}

/**
 * Set material at `(x, y)` (caller ensures in-bounds).
 * @param {FluidWorld} w world
 * @param {number} x column
 * @param {number} y row
 * @param {number} m material id
 * @returns {void}
 */
export const setMat = (w, x, y, m) => {
	w.mat[y * w.worldW + x] = m
}

/**
 * Add moisture into a soil cell (clamped). Returns amount actually stored.
 * @param {FluidWorld} w world
 * @param {number} x column
 * @param {number} y row
 * @param {number} amt amount to add
 * @returns {number} stored delta
 */
export const addMoisture = (w, x, y, amt) => {
	if (amt <= 0) return 0
	const i = y * w.worldW + x
	if (!isSoilMat(w.mat[i])) return 0
	const before = w.moisture[i]
	w.moisture[i] = Math.min(SOIL_CAP, before + amt)
	return w.moisture[i] - before
}

/**
 * Grid water total: free liquid + soil moisture + hanging condensation.
 * @param {FluidWorld} w world
 * @returns {number} total mass
 */
export const totalGridWater = (w) => {
	let t = 0
	for (let i = 0; i < w.liq.length; i++)
		t += w.liq[i] + w.moisture[i] + w.condense[i]
	return t
}

/**
 * Add free liquid at `(x, y)` unless the cell is a liquid barrier.
 * @param {FluidWorld} w world
 * @param {number} x column
 * @param {number} y row
 * @param {number} amt amount to add
 * @returns {number} stored delta
 */
export const addLiquid = (w, x, y, amt) => {
	const i = y * w.worldW + x
	if (isLiquidBarrier(w.mat[i])) return 0
	const before = w.liq[i]
	w.liq[i] = Math.min(LIQ_FULL, before + amt)
	return w.liq[i] - before
}
