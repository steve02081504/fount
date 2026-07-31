/**
 * Right-button wind gesture → local gas drive field.
 *
 * Drag: directed stroke impulses along the path (faster drag → stronger flow).
 * Long still hold: tornado-like clockwise vortex (tangential + updraft + inflow);
 * longer hold → faster; follows while moved; reforms when stopped; clears on release.
 */

import { applyPointer, trimCap } from './pointer.mjs'

/** Movement below this (view cells / tick) counts as still. */
export const STILL_EPS = 0.55
/** Frames of stillness before the vortex appears. */
export const VORTEX_DELAY = 10
/** Visual radius of the vortex (cell aspect ≈ 1×2 → hypot(dx, 2·dy)). */
export const VORTEX_RADIUS = 9
/** Brush radius around a stroke segment. */
export const STROKE_RADIUS = 2.8
/** Maps drag speed (cells/tick) → gas drive amplitude. */
export const STROKE_SPEED_SCALE = 0.55
/** Per-tick vortex strength growth after delay. */
export const VORTEX_GROWTH = 0.14
/** Cap on vortex tangential / core drive. */
export const VORTEX_MAX = 3.4
/** Updraft as a fraction of vortex strength (y↓ negative = lift). */
export const VORTEX_UPLIFT = 1.05
/** Radial inflow as a fraction of vortex strength. */
export const VORTEX_INFLOW = 0.4
/** Stroke trail lifetime in ticks. */
export const STROKE_LIFE = 7
/** Max remembered stroke segments. */
const STROKE_CAP = 14

/**
 * @typedef {{
 *   x0: number, y0: number, x1: number, y1: number,
 *   ux: number, uy: number, life: number,
 * }} StrokeSeg
 * @typedef {{
 *   down: boolean,
 *   x: number, y: number,
 *   lx: number, ly: number,
 *   still: number,
 *   vortexOn: boolean,
 *   strength: number,
 *   strokes: StrokeSeg[],
 * }} WindGesture
 */

/**
 * Fresh gesture state (also used to clear on release).
 * @returns {WindGesture} empty gesture
 */
export const createWindGesture = () => ({
	down: false,
	x: 0, y: 0,
	lx: 0, ly: 0,
	still: 0,
	vortexOn: false,
	strength: 0,
	strokes: [],
})

/**
 * Clear all gesture drive (release / reset).
 * @param {WindGesture} gesture gesture
 * @returns {void}
 */
export const clearWindGesture = (gesture) => {
	gesture.down = false
	gesture.still = 0
	gesture.vortexOn = false
	gesture.strength = 0
	gesture.strokes.length = 0
}

/**
 * Apply a right-button pointer event (press / drag / release).
 * @param {WindGesture} gesture gesture
 * @param {{ x: number, y: number, right: boolean }} ev right-button event
 * @returns {void}
 */
export const windPointer = (gesture, { x, y, right }) => {
	applyPointer(gesture, x, y, right, {
		/**
		 *
		 */
		onDown() {
			gesture.lx = x
			gesture.ly = y
			gesture.still = 0
			gesture.vortexOn = false
			gesture.strength = 0
			gesture.strokes.length = 0
		},
		/**
		 *
		 */
		onUp() {
			clearWindGesture(gesture)
		},
	})
}

/**
 * Advance gesture one sim tick: stroke trail + vortex arming / growth.
 * Call once per frame before `fillWindDrive`.
 * @param {WindGesture} gesture gesture
 * @returns {void}
 */
export const tickWindGesture = (gesture) => {
	if (!gesture.down) return

	for (let index = gesture.strokes.length - 1; index >= 0; index--)
		if (--gesture.strokes[index].life <= 0) gesture.strokes.splice(index, 1)

	const dx = gesture.x - gesture.lx
	const dy = gesture.y - gesture.ly
	const dist = Math.hypot(dx, dy)

	if (dist > STILL_EPS) {
		gesture.still = 0
		const inv = 1 / dist
		const amp = dist * STROKE_SPEED_SCALE
		gesture.strokes.push({
			x0: gesture.lx, y0: gesture.ly, x1: gesture.x, y1: gesture.y,
			ux: dx * inv * amp, uy: dy * inv * amp,
			life: STROKE_LIFE,
		})
		trimCap(gesture.strokes, STROKE_CAP)
		if (gesture.vortexOn)
			gesture.strength = Math.min(VORTEX_MAX, gesture.strength + VORTEX_GROWTH * 0.35)
	}
	else {
		if (gesture.vortexOn && gesture.still === 0)
			// Just stopped after a drag — reform a clean vortex at the new centre.
			gesture.strength = Math.min(VORTEX_MAX, Math.max(gesture.strength, VORTEX_GROWTH * 4))

		gesture.still++
		if (gesture.still >= VORTEX_DELAY) {
			gesture.vortexOn = true
			gesture.strength = Math.min(VORTEX_MAX, gesture.strength + VORTEX_GROWTH)
		}
	}

	gesture.lx = gesture.x
	gesture.ly = gesture.y
}

/**
 * Squared distance from point P to segment AB (view cells).
 * @param {number} px point x
 * @param {number} py point y
 * @param {number} ax segment a x
 * @param {number} ay segment a y
 * @param {number} bx segment b x
 * @param {number} by segment b y
 * @returns {number} squared distance
 */
const dist2ToSeg = (px, py, ax, ay, bx, by) => {
	const abx = bx - ax
	const aby = by - ay
	const apx = px - ax
	const apy = py - ay
	const ab2 = abx * abx + aby * aby
	if (ab2 < 1e-8) return apx * apx + apy * apy
	let t = (apx * abx + apy * aby) / ab2
	if (t < 0) t = 0
	else if (t > 1) t = 1
	const qx = ax + abx * t - px
	const qy = ay + aby * t - py
	return qx * qx + qy * qy
}

/**
 * Paint a tornado-like vortex into drive buffers (world cells).
 * Clockwise tangential + core updraft + weak radial inflow.
 * @param {number} cx world centre x
 * @param {number} cy world centre y
 * @param {number} amp strength
 * @param {number} radius visual radius
 * @param {{ worldW: number, worldH: number }} world size
 * @param {Float32Array} outUx horizontal drive
 * @param {Float32Array} outUy vertical drive
 * @returns {void}
 */
export const paintVortexDrive = (cx, cy, amp, radius, world, outUx, outUy) => {
	if (amp < 0.02) return
	const { worldW: W, worldH: H } = world
	const R = radius
	const minX = Math.max(0, Math.floor(cx - R - 1))
	const maxX = Math.min(W - 1, Math.ceil(cx + R + 1))
	const minY = Math.max(0, Math.floor(cy - R * 0.5 - 1))
	const maxY = Math.min(H - 1, Math.ceil(cy + R * 0.5 + 1))
	const uplift = amp * VORTEX_UPLIFT
	const inflow = amp * VORTEX_INFLOW

	for (let y = minY; y <= maxY; y++)
		for (let x = minX; x <= maxX; x++) {
			const rx = (x + 0.5) - cx
			const ry = (y + 0.5) - cy
			// Tall terminal cells: visual circle via hypot(dx, 2·dy).
			const rVis = Math.hypot(rx, 2 * ry)
			if (rVis > R) continue
			const fall = rVis < 0.35 ? 1 : (1 - rVis / R) ** 1.1
			const rRaw = Math.hypot(rx, ry) || 1
			// Clockwise with y-down: tangential (−ry, rx). Do not halve ty —
			// that downwash on +rx made a right-side hover attractor under gravity.
			const tx = (-ry / rRaw) * amp * fall
			const ty = (rx / rRaw) * amp * fall
			// Inward + updraft so the ring can suspend rain at the centre.
			const ix = (-rx / rRaw) * inflow * fall
			const iy = (-ry / rRaw) * inflow * fall - uplift * fall
			const cell = y * W + x
			outUx[cell] += tx + ix
			outUy[cell] += ty + iy
		}
}

/**
 * Paint gesture drives into scratch velocity targets (view → world via ox/oy).
 * @param {WindGesture} gesture gesture
 * @param {{ worldW: number, worldH: number, ox: number, oy: number }} world fluid world
 * @param {Float32Array} outUx horizontal drive
 * @param {Float32Array} outUy vertical drive
 * @returns {void}
 */
export const fillWindDrive = (gesture, world, outUx, outUy) => {
	outUx.fill(0)
	outUy.fill(0)
	if (!gesture.down) return

	const { worldW: W, worldH: H, ox, oy } = world
	const strokeR2 = STROKE_RADIUS * STROKE_RADIUS

	for (const stroke of gesture.strokes) {
		const fade = stroke.life / STROKE_LIFE
		const ux = stroke.ux * fade
		const uy = stroke.uy * fade
		const minX = Math.max(0, Math.floor(Math.min(stroke.x0, stroke.x1) + ox - STROKE_RADIUS - 1))
		const maxX = Math.min(W - 1, Math.ceil(Math.max(stroke.x0, stroke.x1) + ox + STROKE_RADIUS + 1))
		const minY = Math.max(0, Math.floor(Math.min(stroke.y0, stroke.y1) + oy - STROKE_RADIUS - 1))
		const maxY = Math.min(H - 1, Math.ceil(Math.max(stroke.y0, stroke.y1) + oy + STROKE_RADIUS + 1))
		const ax = stroke.x0 + ox
		const ay = stroke.y0 + oy
		const bx = stroke.x1 + ox
		const by = stroke.y1 + oy
		for (let y = minY; y <= maxY; y++)
			for (let x = minX; x <= maxX; x++) {
				const d2 = dist2ToSeg(x + 0.5, y + 0.5, ax, ay, bx, by)
				if (d2 > strokeR2) continue
				const weight = (1 - d2 / strokeR2) ** 2
				const cell = y * W + x
				outUx[cell] += ux * weight
				outUy[cell] += uy * weight
			}
	}

	if (!gesture.vortexOn) return
	// Cell centre: SGR coords name the cell; swirl attractor must match that glyph.
	paintVortexDrive(gesture.x + ox + 0.5, gesture.y + oy + 0.5, gesture.strength, VORTEX_RADIUS, world, outUx, outUy)
}
