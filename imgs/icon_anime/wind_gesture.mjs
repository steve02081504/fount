/**
 * Right-button wind gesture → local gas drive field.
 *
 * Drag: directed stroke impulses along the path (faster drag → stronger flow).
 * Long still hold: tornado-like clockwise vortex (tangential + updraft + inflow);
 * longer hold → faster; follows while moved; reforms when stopped; clears on release.
 */

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
export const VORTEX_UPLIFT = 1.15
/** Radial inflow as a fraction of vortex strength. */
export const VORTEX_INFLOW = 0.28
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
 * @param {WindGesture} g gesture
 * @returns {void}
 */
export const clearWindGesture = (g) => {
	g.down = false
	g.still = 0
	g.vortexOn = false
	g.strength = 0
	g.strokes.length = 0
}

/**
 * Apply a right-button pointer event (press / drag / release).
 * @param {WindGesture} g gesture
 * @param {{ x: number, y: number, right: boolean }} ev right-button event
 * @returns {void}
 */
export const windPointer = (g, { x, y, right }) => {
	if (!right) {
		clearWindGesture(g)
		return
	}
	if (!g.down) {
		g.down = true
		g.x = g.lx = x
		g.y = g.ly = y
		g.still = 0
		g.vortexOn = false
		g.strength = 0
		g.strokes.length = 0
		return
	}
	g.x = x
	g.y = y
}

/**
 * Advance gesture one sim tick: stroke trail + vortex arming / growth.
 * Call once per frame before `fillWindDrive`.
 * @param {WindGesture} g gesture
 * @returns {void}
 */
export const tickWindGesture = (g) => {
	if (!g.down) return

	for (let i = g.strokes.length - 1; i >= 0; i--)
		if (--g.strokes[i].life <= 0) g.strokes.splice(i, 1)

	const dx = g.x - g.lx
	const dy = g.y - g.ly
	const dist = Math.hypot(dx, dy)

	if (dist > STILL_EPS) {
		g.still = 0
		const inv = 1 / dist
		const amp = dist * STROKE_SPEED_SCALE
		g.strokes.push({
			x0: g.lx, y0: g.ly, x1: g.x, y1: g.y,
			ux: dx * inv * amp, uy: dy * inv * amp,
			life: STROKE_LIFE,
		})
		if (g.strokes.length > STROKE_CAP) g.strokes.splice(0, g.strokes.length - STROKE_CAP)
		if (g.vortexOn)
			g.strength = Math.min(VORTEX_MAX, g.strength + VORTEX_GROWTH * 0.35)
	}
	else {
		if (g.vortexOn && g.still === 0)
			// Just stopped after a drag — reform a clean vortex at the new centre.
			g.strength = Math.min(VORTEX_MAX, Math.max(g.strength, VORTEX_GROWTH * 4))

		g.still++
		if (g.still >= VORTEX_DELAY) {
			g.vortexOn = true
			g.strength = Math.min(VORTEX_MAX, g.strength + VORTEX_GROWTH)
		}
	}

	g.lx = g.x
	g.ly = g.y
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
			// Clockwise with y-down: tangential (−ry, rx).
			const tx = (-ry / rRaw) * amp * fall
			const ty = (rx / rRaw) * amp * fall * 0.5
			// Inward + always-on updraft so the ring can suspend rain.
			const ix = (-rx / rRaw) * inflow * fall
			const iy = (-ry / rRaw) * inflow * fall * 0.5 - uplift * fall
			const cell = y * W + x
			outUx[cell] += tx + ix
			outUy[cell] += ty + iy
		}
}

/**
 * Paint gesture drives into scratch velocity targets (view → world via ox/oy).
 * @param {WindGesture} g gesture
 * @param {{ worldW: number, worldH: number, ox: number, oy: number }} world fluid world
 * @param {Float32Array} outUx horizontal drive
 * @param {Float32Array} outUy vertical drive
 * @returns {void}
 */
export const fillWindDrive = (g, world, outUx, outUy) => {
	outUx.fill(0)
	outUy.fill(0)
	if (!g.down) return

	const { worldW: W, worldH: H, ox, oy } = world
	const strokeR2 = STROKE_RADIUS * STROKE_RADIUS

	for (const s of g.strokes) {
		const fade = s.life / STROKE_LIFE
		const ux = s.ux * fade
		const uy = s.uy * fade
		const minX = Math.max(0, Math.floor(Math.min(s.x0, s.x1) + ox - STROKE_RADIUS - 1))
		const maxX = Math.min(W - 1, Math.ceil(Math.max(s.x0, s.x1) + ox + STROKE_RADIUS + 1))
		const minY = Math.max(0, Math.floor(Math.min(s.y0, s.y1) + oy - STROKE_RADIUS - 1))
		const maxY = Math.min(H - 1, Math.ceil(Math.max(s.y0, s.y1) + oy + STROKE_RADIUS + 1))
		const ax = s.x0 + ox
		const ay = s.y0 + oy
		const bx = s.x1 + ox
		const by = s.y1 + oy
		for (let y = minY; y <= maxY; y++)
			for (let x = minX; x <= maxX; x++) {
				const d2 = dist2ToSeg(x + 0.5, y + 0.5, ax, ay, bx, by)
				if (d2 > strokeR2) continue
				const w = (1 - d2 / strokeR2) ** 2
				const cell = y * W + x
				outUx[cell] += ux * w
				outUy[cell] += uy * w
			}
	}

	if (!g.vortexOn) return
	paintVortexDrive(g.x + ox, g.y + oy, g.strength, VORTEX_RADIUS, world, outUx, outUy)
}
