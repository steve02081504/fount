/**
 * Frame paint + ANSI render for the fountain animation.
 * Optional pointer light: hold torch (ambient dim + radial fill) and/or
 * click ripples (bright expanding rings, no ambient).
 */

import { MAT, LIQ_DRAW, COND_DRAW, isLiquidBarrier, isSoilMat, waterChar, liquidChar, dripChar } from './fluid/index.mjs'
import { sampleLight, RIPPLE_SPEED, RIPPLE_WIDTH } from './gesture/light.mjs'
import { ICON_W, PILLARS, BODY_DIST, maxBodyD } from './icon.mjs'

const RESET = '\x1b[0m'
const FG_AT = '\x1b[30m'
const FG_COL = '\x1b[96m'
const FG_SPLASH = '\x1b[36m'
const FG_TERRAIN = '\x1b[90m'

/** Base RGB for each paint palette entry (truecolor lift target). */
const FG_RGB = {
	[FG_AT]: [28, 28, 34],
	[FG_COL]: [70, 235, 255],
	[FG_SPLASH]: [0, 195, 210],
	[FG_TERRAIN]: [105, 105, 115],
}
/** Palette id for SGR cache keys (null / unknown → 4). */
const FG_ID = new Map([
	[FG_AT, 0],
	[FG_COL, 1],
	[FG_SPLASH, 2],
	[FG_TERRAIN, 3],
])
/** Quantized lift levels for truecolor SGR reuse. */
const LIFT_Q = 32
/** Cached truecolor SGR strings: key = packed (ambient<<12)|(fgId<<7)|(liftQ<<1)|bgBit */
const sgrCache = new Map()

/** Visual radius of the pointer spotlight (cell aspect ≈ 1×2). */
export const LIGHT_RADIUS = 14
/** Ambient dim when a light is active (cells far from the cursor). */
const LIGHT_AMBIENT = 0.3

/** Reused sampleLight destination (compose hot path). */
const lightSample = { ambient: false, lift: 0 }
/** Reused ANSI fragment list — one join per frame instead of per-cell `+=`. */
const frameParts = /** @type {string[]} */ []
/** Glyphs sharing one SGR run — joined once per run. */
const runGlyphs = /** @type {string[]} */ []

/**
 * Smooth radial falloff in view cells (compensates for tall terminal cells).
 * Squared reject before `sqrt`.
 * @param {number} dx columns from light
 * @param {number} dy rows from light
 * @param {number} radius visual radius
 * @returns {number} 0..1 intensity
 */
export const lightFalloff = (dx, dy, radius = LIGHT_RADIUS) => {
	const d2 = dx * dx + 4 * dy * dy
	const r2 = radius * radius
	if (d2 >= r2) return 0
	const t = 1 - Math.sqrt(d2) / radius
	return t * t
}

/**
 * @param {number} c channel 0..255
 * @param {number} lift 0..1+
 * @param {boolean} ambient dim far cells (torch mode)
 * @returns {number} lit channel
 */
const liftChannel = (c, lift, ambient) => {
	const t = lift > 1 ? 1 : lift
	const hot = c + (255 - c) * (ambient ? 0.88 : 0.96)
	if (!ambient) return (c + (hot - c) * t) | 0
	const cold = c * LIGHT_AMBIENT
	return (cold + (hot - cold) * t) | 0
}

/**
 * @param {number} r red
 * @param {number} g green
 * @param {number} b blue
 * @returns {string} truecolor fg SGR
 */
const fgRgb = (r, g, b) => `\x1b[38;2;${r};${g};${b}m`

/**
 * @param {number} r red
 * @param {number} g green
 * @param {number} b blue
 * @returns {string} truecolor bg SGR
 */
const bgRgb = (r, g, b) => `\x1b[48;2;${r};${g};${b}m`

/**
 * Quantized truecolor SGR for a palette entry + lift (cached).
 * @param {string | null} f palette fg or null (bg-only glow)
 * @param {number} lift raw lift
 * @param {boolean} ambient torch ambient dim
 * @returns {string | null} SGR or null if cell stays blank
 */
const litSgr = (f, lift, ambient) => {
	const glow = lift > 1 ? 1 : lift
	const liftQ = glow <= 0 ? 0 : Math.min(LIFT_Q - 1, (glow * (LIFT_Q - 1) + 0.5) | 0)
	const qLift = liftQ / (LIFT_Q - 1)
	const fgId = f == null ? 4 : FG_ID.get(f) ?? 4
	const wantBg = f == null ? qLift >= 0.04 : qLift > 0.08
	if (f == null && !wantBg) return null
	const key = (ambient ? 1 << 12 : 0) | (fgId << 7) | (liftQ << 1) | (wantBg ? 1 : 0)
	let sgr = sgrCache.get(key)
	if (sgr !== undefined) return sgr

	if (f == null) {
		const g = (55 * qLift) | 0
		sgr = bgRgb((g * 0.55) | 0, (g * 0.75) | 0, g)
	}
	else {
		const rgbBase = FG_RGB[f]
		const rgb = fgRgb(
			liftChannel(rgbBase[0], qLift, ambient),
			liftChannel(rgbBase[1], qLift, ambient),
			liftChannel(rgbBase[2], qLift, ambient),
		)
		if (wantBg) {
			const g = ((ambient ? 42 : 58) * qLift) | 0
			sgr = rgb + bgRgb((g * 0.5) | 0, (g * 0.7) | 0, g)
		}
		else sgr = rgb
	}
	sgrCache.set(key, sgr)
	return sgr
}

/**
 * Flush a same-SGR glyph run into `parts`.
 * @param {string[]} parts ANSI fragments
 * @returns {void}
 */
const flushRun = (parts) => {
	const n = runGlyphs.length
	if (!n) return
	if (n === 1) parts.push(runGlyphs[0])
	else parts.push(runGlyphs.join(''))
	runGlyphs.length = 0
}

/**
 * Emit one cell under a palette / truecolor SGR (`sgr === null` → default / blank).
 * @param {string[]} parts ANSI fragments
 * @param {string | null} cur current open SGR
 * @param {string | null} sgr next SGR (null = default)
 * @param {string} glyph character
 * @param {boolean} [resetOnChange=false] emit RESET before a new non-null SGR
 * @returns {string | null} updated current SGR
 */
const emitCell = (parts, cur, sgr, glyph, resetOnChange = false) => {
	if (sgr == null) {
		if (cur !== null) {
			flushRun(parts)
			parts.push(RESET)
		}
		runGlyphs.push(glyph)
		return null
	}
	if (sgr !== cur) {
		flushRun(parts)
		if (resetOnChange && cur !== null) parts.push(RESET)
		parts.push(sgr)
	}
	runGlyphs.push(glyph)
	return sgr
}

/**
 * Join flat char/fg buffers into an ANSI frame string without lighting.
 * Same-SGR glyphs are joined per run to cut fragment count.
 * @param {string[]} ch characters
 * @param {(string | null)[]} fg ANSI fg codes (null = default)
 * @param {number} width columns
 * @param {number} height rows
 * @returns {string} ANSI frame
 */
const renderPlain = (ch, fg, width, height) => {
	const parts = frameParts
	parts.length = 0
	runGlyphs.length = 0
	for (let y = 0; y < height; y++) {
		if (y) {
			flushRun(parts)
			parts.push('\n')
		}
		let cur = null
		const row = y * width
		for (let x = 0; x < width; x++) {
			const f = fg[row + x]
			const glyph = f == null ? ' ' : ch[row + x]
			cur = emitCell(parts, cur, f, glyph)
		}
		if (cur !== null) {
			flushRun(parts)
			parts.push(RESET)
		}
	}
	flushRun(parts)
	return parts.join('')
}

/**
 * Axis-aligned pad around a ripple ring for this age (view cells).
 * @param {number} age ripple age
 * @returns {number} half-extent
 */
const ripplePad = (age) => ((age * RIPPLE_SPEED + RIPPLE_WIDTH) / 2) + 1

/**
 * Join flat char/fg buffers into an ANSI frame string.
 * Torch: dims the scene and lifts a circular cool spotlight.
 * Ripples: bright expanding rings without ambient dim — sampled only near rings.
 * @param {string[]} ch characters
 * @param {(string | null)[]} fg ANSI fg codes (null = default)
 * @param {number} width columns
 * @param {number} height rows
 * @param {import('./gesture/light.mjs').LightGesture} [light] pointer light gesture
 * @returns {string} ANSI frame
 */
export const renderBuffers = (ch, fg, width, height, light = null) => {
	const hasTorch = !!(light?.down && light.torch)
	const ripples = light?.ripples
	const hasRipple = !!ripples?.length
	if (!hasTorch && !hasRipple) return renderPlain(ch, fg, width, height)

	const parts = frameParts
	parts.length = 0
	runGlyphs.length = 0
	const torchR2 = LIGHT_RADIUS * LIGHT_RADIUS

	for (let y = 0; y < height; y++) {
		if (y) {
			flushRun(parts)
			parts.push('\n')
		}
		let cur = null
		const row = y * width
		for (let x = 0; x < width; x++) {
			const f = fg[row + x]
			let needSample = hasTorch
			if (!needSample && hasRipple)
				for (const ripple of ripples) {
					const pad = ripplePad(ripple.age)
					if (Math.abs(x - ripple.x) <= pad * 2 && Math.abs(y - ripple.y) <= pad) {
						needSample = true
						break
					}
				}

			if (!needSample) {
				const glyph = f == null ? ' ' : ch[row + x]
				cur = emitCell(parts, cur, f, glyph, true)
				continue
			}

			// Torch: skip hypot when far outside the disc (ambient still applies).
			if (hasTorch) {
				const dx = x - light.x
				const dy = y - light.y
				if (dx * dx + 4 * dy * dy >= torchR2 && !hasRipple) {
					const sgr = litSgr(f, 0, true)
					if (sgr == null) {
						cur = emitCell(parts, cur, null, ' ', true)
						continue
					}
					cur = emitCell(parts, cur, sgr, f == null ? ' ' : ch[row + x], true)
					continue
				}
			}

			sampleLight(light, x, y, lightFalloff, lightSample)
			const { ambient, lift } = lightSample

			// Ripple-only cells far from the ring keep the plain palette.
			if (!ambient && lift < 0.04) {
				const glyph = f == null ? ' ' : ch[row + x]
				cur = emitCell(parts, cur, f, glyph, true)
				continue
			}

			const sgr = litSgr(f, lift, ambient)
			if (sgr == null) {
				cur = emitCell(parts, cur, null, ' ', true)
				continue
			}
			cur = emitCell(parts, cur, sgr, f == null ? ' ' : ch[row + x], true)
		}
		if (cur !== null) {
			flushRun(parts)
			parts.push(RESET)
		}
	}
	flushRun(parts)
	return parts.join('')
}

/**
 * Thin adapter: Cell[][] → ANSI frame via renderBuffers.
 * @param {({ ch?: string, fg?: string | null } | null)[][]} grid rows of cells
 * @param {number} width columns
 * @param {number} height rows
 * @returns {string} ANSI frame
 */
export const renderGrid = (grid, width, height) => {
	const cells = width * height
	const ch = Array(cells)
	const fg = Array(cells)
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const cell = grid[y][x]
			const i = y * width + x
			ch[i] = cell?.ch ?? ' '
			fg[i] = cell?.fg ?? null
		}
	return renderBuffers(ch, fg, width, height)
}

/**
 * Soft body edge: growing frontier or shrinking min distance.
 * @param {boolean} softBody soft edges enabled
 * @param {number} d body distance
 * @param {number} bodyReach growth frontier
 * @param {number} bodyMinD shrink floor
 * @returns {boolean} edge cell
 */
const isBodyEdge = (softBody, d, bodyReach, bodyMinD) => softBody && (
	(d === bodyReach && bodyReach < maxBodyD) ||
	(bodyMinD > 0 && d === bodyMinD)
)

/**
 * Paint one animation frame from scene state into reused buffers.
 * Single viewport pass writes every cell (no pre-fill); pillars / particles overlay.
 * @param {{
 *   world: import('./fluid/world.mjs').FluidWorld,
 *   width: number, height: number, iconOx: number, iconOy: number,
 *   softPillars: boolean, softBody: boolean, bodyReach: number, bodyMinD: number,
 *   pillars: number, frame: number,
 *   terrain: { solid: Uint8Array, surface: Int16Array, surfaceChar: string[], outline: (string | null)[] },
 *   light?: import('./gesture/light.mjs').LightGesture,
 *   frameCh?: string[], frameFg?: (string | null)[],
 * }} state animation state
 * @returns {string} ANSI frame
 */
export const composeFrame = (state) => {
	const {
		world, width, height, iconOx, iconOy, softPillars, softBody,
		bodyReach, bodyMinD, pillars, frame, terrain, light,
	} = state
	const { ox, mat, liq, particles, condense, liqVx, liqVy } = world
	const { solid, surface, surfaceChar, outline } = terrain
	const { worldW: W, worldH: H } = world
	const cells = width * height

	if (!state.frameCh || state.frameCh.length !== cells) {
		state.frameCh = Array(cells)
		state.frameFg = Array(cells)
	}
	const ch = state.frameCh
	const fg = state.frameFg

	for (let vy = 0; vy < height; vy++)
		for (let vx = 0; vx < width; vx++) {
			const i = vy * width + vx
			const wx = ox + vx
			if (wx < 0 || wx >= W || vy >= H) {
				ch[i] = ' '
				fg[i] = null
				continue
			}
			const wi = vy * W + wx
			const m = mat[wi]
			if (m === MAT.POOL) {
				ch[i] = '@'
				fg[i] = FG_AT
			}
			else if (m === MAT.SLOPE_R) {
				ch[i] = '>'
				fg[i] = FG_AT
			}
			else if (m === MAT.SLOPE_L) {
				ch[i] = '<'
				fg[i] = FG_AT
			}
			else if (m === MAT.BODY) {
				const lx = wx - iconOx
				const ly = vy - iconOy
				const d = ly >= 0 && ly < 16 && lx >= 0 && lx < ICON_W
					? BODY_DIST[ly * ICON_W + lx]
					: 255
				ch[i] = isBodyEdge(softBody, d, bodyReach, bodyMinD) ? '.' : '@'
				fg[i] = FG_AT
			}
			else if (liq[wi] >= LIQ_DRAW) {
				const by = vy + 1
				const bi = by * W + wx
				const falling = by >= H || (
					!isLiquidBarrier(mat[bi])
					&& mat[bi] !== MAT.POOL
					&& liq[bi] < LIQ_DRAW
				)
				ch[i] = liquidChar(liq[wi], wx + vy + frame, falling, liqVx[wi], liqVy[wi])
				fg[i] = FG_SPLASH
			}
			else {
				const above = vy > 0 ? (vy - 1) * W + wx : -1
				if (above >= 0 && isSoilMat(mat[above]) && condense[above] >= COND_DRAW) {
					ch[i] = dripChar(condense[above], wx + frame)
					fg[i] = FG_SPLASH
				}
				else if (solid[wi] && vy === surface[wx]) {
					ch[i] = surfaceChar[wx] || '_'
					fg[i] = FG_TERRAIN
				}
				else if (solid[wi] && outline[wi]) {
					ch[i] = outline[wi]
					fg[i] = FG_TERRAIN
				}
				else {
					ch[i] = ' '
					fg[i] = null
				}
			}
		}

	if (pillars > 0)
		for (const [lx, yTop, yBot] of PILLARS) {
			const h = yBot - yTop + 1
			const g = Math.min(pillars, h)
			for (let k = 0; k < g; k++) {
				const tip = softPillars && k === g - 1 && g < h
				const vx = iconOx - ox + lx
				const vy = iconOy + yBot - k
				if (vy < 0 || vy >= height) continue
				const glyph = tip ? '.' : ':'
				const color = tip ? FG_SPLASH : FG_COL
				if (vx >= 0 && vx < width) {
					const i = vy * width + vx
					ch[i] = glyph
					fg[i] = color
				}
				const vx2 = vx + 1
				if (vx2 >= 0 && vx2 < width) {
					const i = vy * width + vx2
					ch[i] = glyph
					fg[i] = color
				}
			}
		}

	for (let pi = 0; pi < particles.count; pi++) {
		const vx = (particles.x[pi] - ox) | 0
		const vy = particles.y[pi] | 0
		if (vy < 0 || vy >= height || vx < 0 || vx >= width) continue
		const i = vy * width + vx
		ch[i] = waterChar(particles.amt[pi], frame + vx, particles.vx[pi], particles.vy[pi])
		fg[i] = FG_SPLASH
	}

	return renderBuffers(ch, fg, width, height, light ?? null)
}
