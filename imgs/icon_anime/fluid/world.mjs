/**
 * Fluid world grid: materials, liquid, soil water, gas velocity, particles.
 */

import { MAT, SOIL_CAP, LIQ_FULL, LIQ_DRAW, isSoilMat, isLiquidBarrier } from './mat.mjs'
import { createParticlePool, clearParticlePool, totalParticleWater } from './particles.mjs'

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
 *   airDirty: boolean,
 *   gasGeomDirty: boolean,
 *   maxUpdraft: number,
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
		airDirty: true,
		/** Rebuild gas blocked/span caches when air topology (or mat) changes. */
		gasGeomDirty: true,
		/** Most-negative gas uy after `stepGas`; `NaN` until gas has stepped. */
		maxUpdraft: NaN,
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
 * Clear the BFS flood queue.
 * @param {FluidWorld} world world
 * @returns {void}
 */
export const floodClear = (world) => {
	world.floodQ.length = 0
}

/**
 * Push `(x, y)` onto the flood queue.
 * @param {FluidWorld} world world
 * @param {number} x column
 * @param {number} y row
 * @returns {void}
 */
export const floodPush = (world, x, y) => {
	world.floodQ.push(x, y)
}

/**
 * Flat index for world cell `(x, y)`.
 * @param {FluidWorld} world world
 * @param {number} x column
 * @param {number} y row
 * @returns {number} index
 */
export const idx = (world, x, y) => y * world.worldW + x

/**
 * Whether `(x, y)` lies inside the world grid.
 * @param {FluidWorld} world world
 * @param {number} x column
 * @param {number} y row
 * @returns {boolean} in bounds
 */
export const inWorld = (world, x, y) =>
	x >= 0 && y >= 0 && x < world.worldW && y < world.worldH

/**
 * Clear liquid, moisture, gas, particles, and region labels.
 * @param {FluidWorld} world world
 * @returns {void}
 */
export const clearDynamics = (world) => {
	world.liq.fill(0)
	world.moisture.fill(0)
	world.condense.fill(0)
	world.gasUx.fill(0)
	world.gasUy.fill(0)
	world.liqVx.fill(0)
	world.liqVy.fill(0)
	clearParticlePool(world.particles)
	clearParticlePool(world.pendingSplash)
	world.regionId.fill(0)
	world.regions.length = 0
	world.gasTime = 0
	world.airDirty = true
	world.gasGeomDirty = true
	world.maxUpdraft = NaN
}

/**
 * Clear material labels only — moisture/condense persist across rebuilds.
 * @param {FluidWorld} world world
 * @returns {void}
 */
export const clearMaterials = (world) => {
	world.mat.fill(MAT.AIR)
	world.airDirty = true
	world.gasGeomDirty = true
}

/**
 * Mark air / gas geometry dirty when free-liquid draw occupancy may have flipped.
 * @param {FluidWorld} world world
 * @param {number} before amount before mutation
 * @param {number} after amount after mutation
 * @returns {void}
 */
export const markAirIfDrawCrossed = (world, before, after) => {
	if ((before >= LIQ_DRAW) === (after >= LIQ_DRAW)) return
	world.airDirty = true
	world.gasGeomDirty = true
}

/**
 * Dump moisture/condense from non-soil cells into free liquid (or the cell above).
 * @param {FluidWorld} world world
 * @returns {void}
 */
export const releaseNonSoilWater = (world) => {
	const { worldW: W, worldH: H, mat, liq, moisture, condense } = world
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			if (isSoilMat(mat[i])) continue
			const held = moisture[i] + condense[i]
			moisture[i] = 0
			condense[i] = 0
			if (held <= 0) continue
			if (mat[i] === MAT.POOL || mat[i] === MAT.AIR) {
				const before = liq[i]
				liq[i] = Math.min(LIQ_FULL, before + held)
				markAirIfDrawCrossed(world, before, liq[i])
				continue
			}
			if (y > 0 && !isLiquidBarrier(mat[(y - 1) * W + x])) {
				const ai = (y - 1) * W + x
				const before = liq[ai]
				liq[ai] = Math.min(LIQ_FULL, before + held)
				markAirIfDrawCrossed(world, before, liq[ai])
			}
		}
}

/**
 * Set material at `(x, y)` (caller ensures in-bounds).
 * @param {FluidWorld} world world
 * @param {number} x column
 * @param {number} y row
 * @param {number} m material id
 * @returns {void}
 */
export const setMat = (world, x, y, m) => {
	const i = y * world.worldW + x
	if (world.mat[i] === m) return
	world.mat[i] = m
	world.airDirty = true
	world.gasGeomDirty = true
}

/**
 * Add moisture into a soil cell (clamped). Returns amount actually stored.
 * @param {FluidWorld} world world
 * @param {number} x column
 * @param {number} y row
 * @param {number} amt amount to add
 * @returns {number} stored delta
 */
export const addMoisture = (world, x, y, amt) => {
	if (amt <= 0) return 0
	const i = y * world.worldW + x
	if (!isSoilMat(world.mat[i])) return 0
	const before = world.moisture[i]
	world.moisture[i] = Math.min(SOIL_CAP, before + amt)
	return world.moisture[i] - before
}

/**
 * Grid water total: free liquid + soil moisture + hanging condensation.
 * @param {FluidWorld} world world
 * @returns {number} total mass
 */
export const totalGridWater = (world) => {
	let t = 0
	for (let i = 0; i < world.liq.length; i++)
		t += world.liq[i] + world.moisture[i] + world.condense[i]
	return t
}

/**
 * World water total: grid reservoirs + live / pending particles.
 * @param {FluidWorld} world world
 * @returns {number} total mass
 */
export const totalWorldWater = (world) =>
	totalGridWater(world)
	+ totalParticleWater(world.particles)
	+ totalParticleWater(world.pendingSplash)

/**
 * Add free liquid at `(x, y)` unless the cell is a liquid barrier.
 * @param {FluidWorld} world world
 * @param {number} x column
 * @param {number} y row
 * @param {number} amt amount to add
 * @returns {number} stored delta
 */
export const addLiquid = (world, x, y, amt) => {
	const i = y * world.worldW + x
	if (isLiquidBarrier(world.mat[i])) return 0
	const before = world.liq[i]
	world.liq[i] = Math.min(LIQ_FULL, before + amt)
	const stored = world.liq[i] - before
	if (stored > 0) markAirIfDrawCrossed(world, before, world.liq[i])
	return stored
}
