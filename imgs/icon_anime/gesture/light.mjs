/**
 * Left-button light gesture → torch spotlight or click ripple.
 *
 * Hold past TORCH_DELAY → circular cool flashlight (follows while dragged),
 * fading ambient dim + centre lift in/out over TORCH_FADE ticks.
 * Faster release (before torch arms) → high-brightness ring that expands outward.
 */

import { applyPointer, trimCap } from './pointer.mjs'

/** Frames of hold before the flashlight arms. */
export const TORCH_DELAY = 5
/** Frames for torchBlend to ramp 0↔1 (enter / exit). */
export const TORCH_FADE = 10
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
 *   torchBlend: number,
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
	torchBlend: 0,
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
	const r2 = dx * dx + 4 * dy * dy
	const lo = radius - width
	const hi = radius + width
	if (lo > 0 && r2 < lo * lo) return 0
	if (r2 > hi * hi) return 0
	const r = Math.sqrt(r2)
	const d = Math.abs(r - radius)
	if (d >= width) return 0
	const t = 1 - d / width
	return t * t
}

/**
 * Ease torchBlend for lighting (smoothstep).
 * @param {number} t linear 0..1
 * @returns {number} eased 0..1
 */
export const torchEase = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))

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
			// Resume mid fade-out without waiting TORCH_DELAY again.
			if (gesture.torchBlend > 0) {
				gesture.held = TORCH_DELAY
				gesture.torch = true
			}
			else {
				gesture.held = 0
				gesture.torch = false
			}
		},
		/**
		 *
		 */
		onUp() {
			if (!gesture.torch) {
				gesture.ripples.push({ x: gesture.x, y: gesture.y, age: 0, life: RIPPLE_LIFE })
				trimCap(gesture.ripples, RIPPLE_CAP)
				gesture.torchBlend = 0
			}
			gesture.held = 0
			gesture.torch = false
		},
	})
}

/**
 * Advance gesture one sim tick: arm torch, fade blend, age ripples.
 * @param {LightGesture} gesture gesture
 * @returns {void}
 */
export const tickLightGesture = (gesture) => {
	const { ripples } = gesture
	for (let index = ripples.length - 1; index >= 0; index--) {
		const ripple = ripples[index]
		if (++ripple.age >= ripple.life) ripples.splice(index, 1)
	}

	if (gesture.down) {
		gesture.held++
		if (gesture.held >= TORCH_DELAY) gesture.torch = true
	}

	const target = gesture.down && gesture.torch ? 1 : 0
	const blend = gesture.torchBlend
	if (blend === target) return
	const step = 1 / TORCH_FADE
	if (blend < target) {
		const next = blend + step
		gesture.torchBlend = next >= target ? target : next
	}
	else {
		const next = blend - step
		gesture.torchBlend = next <= target ? target : next
	}
}

/** Reused sampleLight destination. */
const lightSampleScratch = { ambient: 0, lift: 0 }

/**
 * Combined lift at a view cell (torch fill + ripple rings).
 * Writes into `out` (defaults to a reused module slot) to avoid per-cell alloc.
 * `ambient` is torch dim strength 0..1 (eased); ripples never set ambient.
 * @param {LightGesture} gesture gesture
 * @param {number} x view column
 * @param {number} y view row
 * @param {(dx: number, dy: number, radius?: number) => number} torchFalloff radial fill
 * @param {{ ambient: number, lift: number }} [out] sample destination
 * @returns {{ ambient: number, lift: number }} lighting sample
 */
export const sampleLight = (gesture, x, y, torchFalloff, out = lightSampleScratch) => {
	let lift = 0
	const ambient = torchEase(gesture.torchBlend)
	if (ambient > 0) lift = torchFalloff(x - gesture.x, y - gesture.y) * ambient

	for (const ripple of gesture.ripples) {
		const fade = (1 - ripple.age / ripple.life) ** 1.2
		const ring = rippleFalloff(x - ripple.x, y - ripple.y, ripple.age * RIPPLE_SPEED) * fade * RIPPLE_GAIN
		if (ring > lift) lift = ring
	}
	out.ambient = ambient
	out.lift = lift
	return out
}
