/**
 * One-tick fluid orchestration: air labels → gas → wind lift → particles → liquid.
 *
 * Scene / tests call this (or the individual steps). `labelAirRegions` runs only
 * when `world.airDirty` (mat / LIQ_DRAW occupancy changed). `stepLiquid` re-labels
 * mid-tick when particles / lift dirtied free-liquid topology.
 */

import { labelAirRegions, stepGas } from './gas.mjs'
import { stepLiquid } from './liquid.mjs'
import { liftLiquidByWind, stepParticles } from './particles.mjs'

/** @typedef {import('./world.mjs').FluidWorld} FluidWorld */

/** No-op impact handler (module-level — avoid per-tick closure alloc). */
const NOOP_HIT = () => { /* airborne until land / expire-deposit */ }

/**
 * Advance the full fluid stack one tick.
 * @param {FluidWorld} world fluid world
 * @param {{
 *   time?: number,
 *   seed?: number,
 *   forceWind?: number,
 *   driveUx?: Float32Array,
 *   driveUy?: Float32Array,
 *   onHit?: (world: FluidWorld, x: number, y: number, mat: number, particle: import('./particles.mjs').ParticleView, wet: boolean, state: unknown) => void,
 *   state?: unknown,
 *   beforeParticles?: () => void,
 * }} [opts] gas drive + particle impact + optional rain inject
 * @returns {void}
 */
export const stepFluid = (world, opts = {}) => {
	if (world.airDirty) labelAirRegions(world)
	stepGas(world, opts)
	liftLiquidByWind(world)
	opts.beforeParticles?.()
	stepParticles(world, opts.onHit || NOOP_HIT, opts.state)
	stepLiquid(world)
}
