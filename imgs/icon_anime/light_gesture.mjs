/**
 * Left-button light gesture → torch spotlight or click ripple.
 *
 * Hold past TORCH_DELAY → circular cool flashlight (follows while dragged).
 * Faster release (before torch arms) → high-brightness ring that expands outward.
 */

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
 * @param {LightGesture} g gesture
 * @param {{ x: number, y: number, left: boolean }} ev left-button event
 * @returns {void}
 */
export const lightPointer = (g, { x, y, left }) => {
	if (!left) {
		if (g.down && !g.torch) {
			g.ripples.push({ x: g.x, y: g.y, age: 0, life: RIPPLE_LIFE })
			if (g.ripples.length > RIPPLE_CAP)
				g.ripples.splice(0, g.ripples.length - RIPPLE_CAP)
		}
		g.down = false
		g.held = 0
		g.torch = false
		return
	}
	if (!g.down) {
		g.down = true
		g.x = x
		g.y = y
		g.held = 0
		g.torch = false
		return
	}
	g.x = x
	g.y = y
}

/**
 * Advance gesture one sim tick: arm torch, age ripples.
 * @param {LightGesture} g gesture
 * @returns {void}
 */
export const tickLightGesture = (g) => {
	for (let i = g.ripples.length - 1; i >= 0; i--)
		if (++g.ripples[i].age >= g.ripples[i].life) g.ripples.splice(i, 1)

	if (!g.down) return
	g.held++
	if (g.held >= TORCH_DELAY) g.torch = true
}

/**
 * Combined lift at a view cell (torch fill + ripple rings).
 * @param {LightGesture | null | undefined} g gesture
 * @param {number} x view column
 * @param {number} y view row
 * @param {(dx: number, dy: number, radius?: number) => number} torchFalloff radial fill
 * @returns {{ ambient: boolean, lift: number }} lighting sample
 */
export const sampleLight = (g, x, y, torchFalloff) => {
	if (!g) return { ambient: false, lift: 0 }

	let lift = 0
	const ambient = g.down && g.torch
	if (ambient) lift = torchFalloff(x - g.x, y - g.y)

	for (const r of g.ripples) {
		const fade = (1 - r.age / r.life) ** 1.2
		const ring = rippleFalloff(x - r.x, y - r.y, r.age * RIPPLE_SPEED) * fade * RIPPLE_GAIN
		if (ring > lift) lift = ring
	}
	return { ambient, lift }
}
