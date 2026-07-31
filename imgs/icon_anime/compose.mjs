/**
 * Frame paint + ANSI render for the fountain animation.
 */

import { MAT, LIQ_DRAW, COND_DRAW, isLiquidBarrier, isSoilMat, waterChar, liquidChar, dripChar } from './fluid/index.mjs'
import { ICON_W, PILLARS, BODY_DIST, maxBodyD } from './icon.mjs'

const RESET = '\x1b[0m'
const FG_AT = '\x1b[30m'
const FG_COL = '\x1b[96m'
const FG_SPLASH = '\x1b[36m'
const FG_TERRAIN = '\x1b[90m'

/**
 * Join flat char/fg buffers into an ANSI frame string.
 * @param {string[]} ch characters
 * @param {(string | null)[]} fg ANSI fg codes (null = default)
 * @param {number} width columns
 * @param {number} height rows
 * @returns {string} ANSI frame
 */
export const renderBuffers = (ch, fg, width, height) => {
	const out = []
	for (let y = 0; y < height; y++) {
		let line = ''
		let cur = null
		const row = y * width
		for (let x = 0; x < width; x++) {
			const f = fg[row + x]
			if (f == null) {
				if (cur !== null) {
					line += RESET
					cur = null
				}
				line += ' '
				continue
			}
			if (f !== cur) {
				line += f
				cur = f
			}
			line += ch[row + x]
		}
		if (cur !== null) line += RESET
		out.push(line)
	}
	return out.join('\n')
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
 * Paint one animation frame from scene state into reused buffers.
 * @param {{
 *   world: import('./fluid/world.mjs').FluidWorld,
 *   width: number, height: number, iconOx: number, iconOy: number,
 *   softPillars: boolean, softBody: boolean, bodyReach: number, bodyMinD: number,
 *   pillars: number, frame: number,
 *   terrain: { solid: Uint8Array, surface: Int16Array, surfaceChar: string[], outline: (string | null)[] },
 *   frameCh?: string[], frameFg?: (string | null)[],
 * }} state animation state
 * @returns {string} ANSI frame
 */
export const composeFrame = (state) => {
	const {
		world, width, height, iconOx, iconOy, softPillars, softBody,
		bodyReach, bodyMinD, pillars, frame, terrain,
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
	ch.fill(' ')
	fg.fill(null)

	/**
	 * Write a glyph into the view buffer if in bounds.
	 * @param {number} vx view column
	 * @param {number} vy view row
	 * @param {string} c character
	 * @param {string} f ANSI fg
	 * @returns {void}
	 */
	const paint = (vx, vy, c, f) => {
		if (vy < 0 || vy >= height || vx < 0 || vx >= width) return
		const i = vy * width + vx
		ch[i] = c
		fg[i] = f
	}

	/**
	 * Soft body edge: growing frontier or shrinking min distance.
	 * @param {number} d body distance
	 * @returns {boolean} edge cell
	 */
	const isBodyEdge = (d) => softBody && (
		(d === bodyReach && bodyReach < maxBodyD) ||
		(bodyMinD > 0 && d === bodyMinD)
	)

	for (let vy = 0; vy < height; vy++)
		for (let vx = 0; vx < width; vx++) {
			const x = ox + vx
			const y = vy
			if (x < 0 || x >= W || y < 0 || y >= H || !solid[y * W + x]) continue
			if (y === surface[x]) {
				paint(vx, vy, surfaceChar[x] || '_', FG_TERRAIN)
				continue
			}
			const oc = outline[y * W + x]
			if (oc) paint(vx, vy, oc, FG_TERRAIN)
		}

	for (let vy = 0; vy < height; vy++)
		for (let vx = 0; vx < width; vx++) {
			const wx = ox + vx
			const i = vy * W + wx
			const m = mat[i]
			if (m === MAT.POOL) paint(vx, vy, '@', FG_AT)
			else if (m === MAT.SLOPE_R) paint(vx, vy, '>', FG_AT)
			else if (m === MAT.SLOPE_L) paint(vx, vy, '<', FG_AT)
			else if (m === MAT.BODY) {
				const lx = wx - iconOx
				const ly = vy - iconOy
				const d = ly >= 0 && ly < 16 && lx >= 0 && lx < ICON_W
					? BODY_DIST[ly * ICON_W + lx]
					: 255
				paint(vx, vy, isBodyEdge(d) ? '.' : '@', FG_AT)
			}
			else if (liq[i] >= LIQ_DRAW) {
				const by = vy + 1
				const bi = by * W + wx
				const falling = by >= H || (
					!isLiquidBarrier(mat[bi])
					&& mat[bi] !== MAT.POOL
					&& liq[bi] < LIQ_DRAW
				)
				paint(vx, vy, liquidChar(liq[i], wx + vy + frame, falling, liqVx[i], liqVy[i]), FG_SPLASH)
			}
			else if (vy > 0) {
				const above = (vy - 1) * W + wx
				if (isSoilMat(mat[above]) && condense[above] >= COND_DRAW)
					paint(vx, vy, dripChar(condense[above], wx + frame), FG_SPLASH)
			}
		}

	if (pillars > 0)
		for (const [lx, yTop, yBot] of PILLARS) {
			const h = yBot - yTop + 1
			const g = Math.min(pillars, h)
			for (let k = 0; k < g; k++) {
				const tip = softPillars && k === g - 1 && g < h
				const vx = iconOx - ox + lx
				const glyph = tip ? '.' : ':'
				const color = tip ? FG_SPLASH : FG_COL
				paint(vx, iconOy + yBot - k, glyph, color)
				paint(vx + 1, iconOy + yBot - k, glyph, color)
			}
		}

	for (let i = 0; i < particles.count; i++) {
		const vx = (particles.x[i] - ox) | 0
		const vy = particles.y[i] | 0
		if (vy < 0 || vy >= height || vx < 0 || vx >= width) continue
		paint(vx, vy, waterChar(particles.amt[i], frame + vx, particles.vx[i], particles.vy[i]), FG_SPLASH)
	}

	return renderBuffers(ch, fg, width, height)
}
