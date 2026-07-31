/**
 * Left-button light gesture → torch spotlight or click ripple.
 *
 * Hold past TORCH_DELAY → circular cool flashlight (follows while dragged).
 * Faster release (before torch arms) → high-brightness ring that expands outward.
 */

import { applyPointer, trimCap } from './pointer.mjs'

/** Frames of hold before the flashlight appears. */
export const TORCH_DELAY = 5
/** Ripple expansion speed (visual radius units / tick; aspect via hypot(dx, 2·dy)). */
export const RIPPLE_SPEED = 1.85
/** Soft half-width of the ripple ring. */
export const RIPPLE_WIDTH = 2.4
/** Ripple lifetime in ticks. */
export const RIPPLE_LIFE = 20
/** Peak ring gain (>1 → brighter than torch centre). */
export const RIPPLE_GAIN = 1.35
/** Max concurrent ripples. */
const RIPPLE_CAP = 6

/**
 * @typedef {{ x: number, y: number, age: number, life: number }} LightRipple
 * @typedef {{
 *   down: boolean,
 *   x: number, y: number,
 *   held: number,
 *   torch: boolean,
 *   ripples: LightRipple[],
 * }} LightGesture
 */

/**
 * Fresh light gesture state.
 * @returns {LightGesture} empty gesture
 */
export const createLightGesture = () => ({
	down: false,
	x: 0, y: 0,
	held: 0,
	torch: false,
	ripples: [],
})

/**
 * Soft ring falloff: peak on the wavefront, zero at centre / outside.
 * @param {number} dx columns from origin
 * @param {number} dy rows from origin
 * @param {number} radius visual ring radius
 * @param {number} [width] soft half-width
 * @returns {number} 0..1 intensity
 */
export const rippleFalloff = (dx, dy, radius, width = RIPPLE_WIDTH) => {
	const r = Math.hypot(dx, dy * 2)
	const d = Math.abs(r - radius)
	if (d >= width) return 0
	const t = 1 - d / width
	return t * t
}

/**
 * Apply a left-button pointer event (press / drag / release).
 * @param {LightGesture} gesture gesture
 * @param {{ x: number, y: number, left: boolean }} ev left-button event
 * @returns {void}
 */
export const lightPointer = (gesture, { x, y, left }) => {
	applyPointer(gesture, x, y, left, {
		/**
		 *
		 */
		onDown() {
			gesture.held = 0
			gesture.torch = false
		},
		/**
		 *
		 */
		onUp() {
			if (!gesture.torch) {
				gesture.ripples.push({ x: gesture.x, y: gesture.y, age: 0, life: RIPPLE_LIFE })
				trimCap(gesture.ripples, RIPPLE_CAP)
			}
			gesture.held = 0
			gesture.torch = false
		},
	})
}

/**
 * Advance gesture one sim tick: arm torch, age ripples.
 * @param {LightGesture} gesture gesture
 * @returns {void}
 */
export const tickLightGesture = (gesture) => {
	for (let index = gesture.ripples.length - 1; index >= 0; index--)
		if (++gesture.ripples[index].age >= gesture.ripples[index].life)
			gesture.ripples.splice(index, 1)

	if (!gesture.down) return
	gesture.held++
	if (gesture.held >= TORCH_DELAY) gesture.torch = true
}

/**
 * Combined lift at a view cell (torch fill + ripple rings).
 * Writes into `out` (defaults to a reused module slot) to avoid per-cell alloc.
 * @param {LightGesture} gesture gesture
 * @param {number} x view column
 * @param {number} y view row
 * @param {(dx: number, dy: number, radius?: number) => number} torchFalloff radial fill
 * @param {{ ambient: boolean, lift: number }} [out] sample destination
 * @returns {{ ambient: boolean, lift: number }} lighting sample
 */
const _lightSample = { ambient: false, lift: 0 }

export const sampleLight = (gesture, x, y, torchFalloff, out = _lightSample) => {
	let lift = 0
	const ambient = gesture.down && gesture.torch
	if (ambient) lift = torchFalloff(x - gesture.x, y - gesture.y)

	for (const ripple of gesture.ripples) {
		const fade = (1 - ripple.age / ripple.life) ** 1.2
		const ring = rippleFalloff(x - ripple.x, y - ripple.y, ripple.age * RIPPLE_SPEED) * fade * RIPPLE_GAIN
		if (ring > lift) lift = ring
	}
	out.ambient = ambient
	out.lift = lift
	return out
}
