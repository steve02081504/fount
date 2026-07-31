/**
 * Rain / splash particles with gas drag.
 */

import { MAT, LIQ_DRAW } from './mat.mjs'

/** @typedef {import('./world.mjs').FluidWorld} FluidWorld
 * @typedef {import('./world.mjs').FluidParticle} FluidParticle
 */

/** Particle velocity blend toward local gas (horizontal). */
export const GAS_DRAG = 0.22
/** Vertical gas coupling for rain (weaker — gravity dominates). */
export const GAS_DRAG_Y = 0.06

const GRAVITY = 0.12
const MAX_VY = 1.15
const PARTICLE_CAP = 1200

/**
 * Spawn a rain/splash particle if under the cap.
 * @param {FluidWorld} w world
 * @param {number} x column
 * @param {number} y row
 * @param {number} vx horizontal velocity
 * @param {number} vy vertical velocity
 * @param {number} [life=40] remaining ticks
 * @param {number} [amt=0.4] water mass
 * @returns {void}
 */
export const spawnParticle = (w, x, y, vx, vy, life = 40, amt = 0.4) => {
	if (w.particles.length > PARTICLE_CAP) return
	w.particles.push({ x, y, vx, vy, life, amt })
}

/**
 * Queue a splash particle for the next step.
 * @param {FluidWorld} w world
 * @param {number} x column
 * @param {number} y row
 * @param {number} vx horizontal velocity
 * @param {number} vy vertical velocity
 * @param {number} [life=18] remaining ticks
 * @param {number} [amt=0.25] water mass
 * @returns {void}
 */
export const queueSplash = (w, x, y, vx, vy, life = 18, amt = 0.25) => {
	w.pendingSplash.push({ x, y, vx, vy, life, amt })
}

/**
 * Advance particles with gas drag; call `onHit` on solid / wet cells.
 * @param {FluidWorld} w world
 * @param {(w: FluidWorld, x: number, y: number, m: number, p: FluidParticle, wet: boolean, hitCtx: unknown) => void} onHit impact callback
 * @param {unknown} [hitCtx] opaque context forwarded to onHit
 * @returns {void}
 */
export const stepParticles = (w, onHit, hitCtx) => {
	const next = []
	const { worldW: W, worldH: H, gasUx, gasUy, mat, liq } = w

	for (const p of w.pendingSplash)
		if (w.particles.length + next.length < PARTICLE_CAP)
			next.push(p)
	w.pendingSplash.length = 0

	for (const p of w.particles) {
		const gx = p.x | 0
		const gy = p.y | 0
		if (gx >= 0 && gy >= 0 && gx < W && gy < H) {
			const gi = gy * W + gx
			p.vx += (gasUx[gi] - p.vx) * GAS_DRAG
			p.vy += (gasUy[gi] - p.vy) * GAS_DRAG_Y
		}
		p.vy = Math.min(MAX_VY, p.vy + GRAVITY)
		if (--p.life <= 0) continue

		const nx = p.x + p.vx
		const ny = p.y + p.vy

		if (nx < 0 || nx >= W || ny >= H) continue
		if (ny < 0) {
			p.x = nx
			p.y = ny
			next.push(p)
			continue
		}

		const cx = nx | 0
		const cy = ny | 0
		if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue

		const i = cy * W + cx
		const m = mat[i]
		const wet = liq[i] >= LIQ_DRAW

		if (m === MAT.AIR && !wet) {
			p.x = nx
			p.y = ny
			next.push(p)
			continue
		}

		onHit(w, cx, cy, m, p, wet, hitCtx)
	}

	w.particles = next
}
