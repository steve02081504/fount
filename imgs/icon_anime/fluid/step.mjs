/**
 * One-tick fluid orchestration: air labels → gas → wind lift → particles → liquid.
 *
 * Scene / tests call this (or the individual steps). `stepLiquid` re-labels after
 * particles may have changed `liq` topology — do not add a third trailing label.
 */

import { labelAirRegions, stepGas } from './gas.mjs'
import { stepLiquid } from './liquid.mjs'
import { liftLiquidByWind, stepParticles } from './particles.mjs'

/** @typedef {import('./world.mjs').FluidWorld} FluidWorld */

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
	labelAirRegions(world)
	stepGas(world, opts)
	liftLiquidByWind(world)
	opts.beforeParticles?.()
	stepParticles(world, opts.onHit || (() => { /* airborne until land / expire-deposit */ }), opts.state)
	stepLiquid(world)
}
