/**
 * Rain / splash particles with gas drag — SoA pool, no per-tick object alloc.
 */

import { MAT, LIQ_DRAW } from './mat.mjs'

/** @typedef {import('./world.mjs').FluidWorld} FluidWorld
 * @typedef {{
 *   x: Float32Array, y: Float32Array,
 *   vx: Float32Array, vy: Float32Array,
 *   life: Float32Array, amt: Float32Array,
 *   count: number,
 * }} ParticlePool
 */

/** Particle velocity blend toward local gas (horizontal). */
export const GAS_DRAG = 0.22
/** Vertical gas coupling for rain (weaker — gravity dominates). */
export const GAS_DRAG_Y = 0.06

const GRAVITY = 0.12
const MAX_VY = 1.15
const PARTICLE_CAP = 1200

/**
 * Allocate an empty particle SoA pool.
 * @param {number} [cap=PARTICLE_CAP] capacity
 * @returns {ParticlePool} pool
 */
export const createParticlePool = (cap = PARTICLE_CAP) => ({
	x: new Float32Array(cap),
	y: new Float32Array(cap),
	vx: new Float32Array(cap),
	vy: new Float32Array(cap),
	life: new Float32Array(cap),
	amt: new Float32Array(cap),
	count: 0,
})

/**
 * Clear a particle pool.
 * @param {ParticlePool} pool particle pool
 * @returns {void}
 */
export const clearParticlePool = (pool) => {
	pool.count = 0
}

/**
 * Push one particle into a pool (no-op if full).
 * @param {ParticlePool} pool particle pool
 * @param {number} x column
 * @param {number} y row
 * @param {number} vx horizontal velocity
 * @param {number} vy vertical velocity
 * @param {number} life remaining ticks
 * @param {number} amt water mass
 * @returns {number} index written, or -1 if full
 */
const pushParticle = (pool, x, y, vx, vy, life, amt) => {
	const i = pool.count
	if (i >= pool.x.length) return -1
	pool.x[i] = x
	pool.y[i] = y
	pool.vx[i] = vx
	pool.vy[i] = vy
	pool.life[i] = life
	pool.amt[i] = amt
	pool.count = i + 1
	return i
}

/**
 * Spawn a rain/splash particle if under the cap.
 * @param {FluidWorld} world fluid world
 * @param {number} x column
 * @param {number} y row
 * @param {number} vx horizontal velocity
 * @param {number} vy vertical velocity
 * @param {number} [life=40] remaining ticks
 * @param {number} [amt=0.4] water mass
 * @returns {void}
 */
export const spawnParticle = (world, x, y, vx, vy, life = 40, amt = 0.4) => {
	pushParticle(world.particles, x, y, vx, vy, life, amt)
}

/**
 * Queue a splash particle for the next step.
 * @param {FluidWorld} world fluid world
 * @param {number} x column
 * @param {number} y row
 * @param {number} vx horizontal velocity
 * @param {number} vy vertical velocity
 * @param {number} [life=18] remaining ticks
 * @param {number} [amt=0.25] water mass
 * @returns {number} pending index, or -1 if full
 */
export const queueSplash = (world, x, y, vx, vy, life = 18, amt = 0.25) =>
	pushParticle(world.pendingSplash, x, y, vx, vy, life, amt)

/**
 * Mutable particle view passed to impact handlers (fields live in the SoA).
 * @typedef {{ x: number, y: number, vx: number, vy: number, life: number, amt: number }} ParticleView
 */

/**
 * Advance particles with gas drag; call `onHit` on solid / wet cells.
 * @param {FluidWorld} world fluid world
 * @param {(world: FluidWorld, x: number, y: number, mat: number, particle: ParticleView, wet: boolean, state: unknown) => void} onHit impact callback
 * @param {unknown} [state] animation / caller state forwarded to onHit
 * @returns {void}
 */
export const stepParticles = (world, onHit, state) => {
	const live = world.particles
	const pending = world.pendingSplash
	const { worldW: W, worldH: H, gasUx, gasUy, mat, liq } = world
	const cap = live.x.length

	// Drain splash queue into the live pool (may overwrite slots after count).
	for (let i = 0; i < pending.count && live.count < cap; i++) {
		const dst = live.count++
		live.x[dst] = pending.x[i]
		live.y[dst] = pending.y[i]
		live.vx[dst] = pending.vx[i]
		live.vy[dst] = pending.vy[i]
		live.life[dst] = pending.life[i]
		live.amt[dst] = pending.amt[i]
	}
	pending.count = 0

	let write = 0
	const view = { x: 0, y: 0, vx: 0, vy: 0, life: 0, amt: 0 }

	for (let i = 0; i < live.count; i++) {
		const px = live.x[i]
		const py = live.y[i]
		let pvx = live.vx[i]
		let pvy = live.vy[i]
		const life = live.life[i] - 1
		const amt = live.amt[i]

		const gx = px | 0
		const gy = py | 0
		if (gx >= 0 && gy >= 0 && gx < W && gy < H) {
			const gi = gy * W + gx
			pvx += (gasUx[gi] - pvx) * GAS_DRAG
			pvy += (gasUy[gi] - pvy) * GAS_DRAG_Y
		}
		pvy = Math.min(MAX_VY, pvy + GRAVITY)
		if (life <= 0) continue

		const nx = px + pvx
		const ny = py + pvy

		if (nx < 0 || nx >= W || ny >= H) continue
		if (ny < 0) {
			live.x[write] = nx
			live.y[write] = ny
			live.vx[write] = pvx
			live.vy[write] = pvy
			live.life[write] = life
			live.amt[write] = amt
			write++
			continue
		}

		const cx = nx | 0
		const cy = ny | 0
		if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue

		const cell = cy * W + cx
		const m = mat[cell]
		const wet = liq[cell] >= LIQ_DRAW

		if (m === MAT.AIR && !wet) {
			live.x[write] = nx
			live.y[write] = ny
			live.vx[write] = pvx
			live.vy[write] = pvy
			live.life[write] = life
			live.amt[write] = amt
			write++
			continue
		}

		view.x = nx
		view.y = ny
		view.vx = pvx
		view.vy = pvy
		view.life = life
		view.amt = amt
		onHit(world, cx, cy, m, view, wet, state)
	}

	live.count = write
}
