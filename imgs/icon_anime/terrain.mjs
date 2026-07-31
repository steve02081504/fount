/**
 * Deterministic Terraria-style ASCII terrain + cave generation.
 * Surface is anchored at the icon pedestal (land on both ends) and walks
 * outward with constrained slopes / platforms / cliffs; underground uses
 * noise cavities, CA cleanup, and injected connector templates (U-tubes, necks).
 *
 * `solid` is a flat Uint8Array indexed as `y * W + x` (same layout as fluid grids).
 */

import { hash01 } from './hash.mjs'

/** Surface / wall outline characters. */
export const TERRAIN_CH = {
	FLAT: '_',
	FLAT_ALT: '-',
	SLOPE_UP: '/',   // rising to the right
	SLOPE_DOWN: '\\', // falling to the right
	WALL: '|',
	FLOOR: '-',
	CEIL: '-',
}

/**
 * @typedef {{
 *   surface: Int16Array,
 *   solid: Uint8Array,
 *   worldW: number,
 *   worldH: number,
 *   surfaceChar: string[],
 *   footX0: number,
 *   footX1: number,
 *   features: TerrainFeature[],
 *   viewW: number,
 *   ox: number,
 * }} TerrainData
 *
 * @typedef {{
 *   type: 'u_tube' | 'chamber' | 'neck',
 *   x0: number, x1: number, y0: number, y1: number,
 *   wells?: [number, number],
 * }} TerrainFeature
 *
 * @typedef {{ id: number, cx: number, cy: number, size: number }} CavityRegion
 */

/** Visible land columns that must meet the tall-land floor (fraction of view width). */
export const TALL_LAND_FRACTION = 0.3
/** Tall land = column thickness ≥ this fraction of screen (view) height. */
export const TALL_LAND_HEIGHT_FRAC = 0.25
/** Columns of land forced flush with the pedestal on each outer end. */
const PEDESTAL_SHOULDER = 3

/**
 * Generate full-width terrain for a fluid world.
 * Surface is anchored at the icon pedestal and walks outward so both base ends
 * sit on land; ≥30% of view columns keep land thickness ≥ ¼ screen height.
 * @param {{ worldW: number, worldH: number, viewW: number, viewH: number, ox: number }} world fluid world size fields
 * @param {{ iconOx: number, iconOy: number, seed: number, iconBaseRows: number[], iconBaseX0: number, iconBaseX1: number }} opts icon placement and seed
 * @returns {TerrainData} terrain data
 */
export function generateTerrain(world, {
	iconOx, iconOy, seed,
	iconBaseRows, iconBaseX0, iconBaseX1,
}) {
	const { worldW: W, worldH: H, viewW, viewH, ox } = world
	const lastBase = iconBaseRows[iconBaseRows.length - 1]
	const baseY = Math.min(H - 4, iconOy + lastBase)
	const minY = Math.max(2, iconOy + 12)
	const maxY = H - 3
	const footX0 = iconOx + iconBaseX0
	const footX1 = iconOx + iconBaseX1

	const surface = buildSurface(W, {
		baseY, minY, maxY, seed,
		footX0, footX1, viewH, viewW, ox, H,
	})

	const solid = new Uint8Array(W * H)
	for (let x = 0; x < W; x++) {
		const top = surface[x]
		for (let y = top; y < H; y++)
			solid[y * W + x] = 1
	}

	carveNoiseCaves(solid, surface, W, H, seed)
	cellularCleanup(solid, surface, W, H, 2)

	const features = []
	injectConnectors(solid, surface, features, { W, H, seed, iconOx, iconBaseX0, iconBaseX1 })

	carveIconFootprint(solid, surface, W, H, footX0, footX1, baseY)

	const surfaceChar = buildSurfaceChars(surface, W)

	return { surface, solid, worldW: W, worldH: H, surfaceChar, footX0, footX1, features, viewW, ox }
}

/**
 * Constrained random-walk surface anchored at the icon pedestal.
 * @param {number} W parameter
 * @param {{ baseY: number, minY: number, maxY: number, seed: number, footX0: number, footX1: number, viewH: number, viewW: number, ox: number, H: number }} opts parameter
 * @returns {Int16Array} result
 */
function buildSurface(W, {
	baseY, minY, maxY, seed,
	footX0, footX1, viewH, viewW, ox, H,
}) {
	const surface = new Int16Array(W)
	const x0 = Math.max(0, Math.min(W, footX0))
	const x1 = Math.max(x0, Math.min(W, footX1))

	for (let x = x0; x < x1; x++)
		surface[x] = baseY

	const shoulder = Math.min(PEDESTAL_SHOULDER, Math.max(1, (x1 - x0) >> 2))
	for (let i = 1; i <= shoulder; i++) {
		if (x0 - i >= 0) surface[x0 - i] = baseY
		if (x1 + i - 1 < W) surface[x1 + i - 1] = baseY
	}

	walkSurface(surface, x0 - shoulder - 1, -1, baseY, { minY, maxY, seed })
	walkSurface(surface, x1 + shoulder, 1, baseY, { minY, maxY, seed })

	softClampSpikes(surface, W)
	ensureTallLand(surface, {
		W, H, viewH, viewW, ox, seed, footX0: x0, footX1: x1, baseY,
	})
	for (let x = Math.max(0, x0 - shoulder); x < Math.min(W, x1 + shoulder); x++)
		surface[x] = baseY

	return surface
}

/**
 * Random-walk surface from an anchor column in `dir` (±1).
 * @param {Int16Array} surface parameter
 * @param {number} startX first column to write
 * @param {number} dir +1 rightward / -1 leftward
 * @param {number} startY height at the adjacent anchor
 * @param {{ minY: number, maxY: number, seed: number }} opts parameter
 * @returns {*} result
 */
function walkSurface(surface, startX, dir, startY, { minY, maxY, seed }) {
	const W = surface.length
	if (startX < 0 || startX >= W) return

	let y = startY
	let slope = 0
	let plateau = 0
	for (let x = startX; dir > 0 ? x < W : x >= 0; x += dir) {
		const r = hash01(x + seed, 3)
		const feature = hash01(x + seed * 2, 19)

		if (plateau > 0)
			plateau--
		else if (feature > 0.92) {
			const drop = 2 + (hash01(x, seed + 7) * 3 | 0)
			y += hash01(x, seed + 8) > 0.5 ? drop : -drop
			slope = 0
			plateau = 1 + (hash01(x, seed + 9) * 3 | 0)
		}
		else if (feature > 0.78) {
			slope = 0
			plateau = 3 + (hash01(x, seed + 11) * 6 | 0)
		}
		else if (feature > 0.62)
			slope = Math.max(-2, Math.min(2, slope + (r > 0.5 ? 1 : -1)))
		else if (r < 0.25)
			slope = Math.max(-2, slope - 1)
		else if (r > 0.75)
			slope = Math.min(2, slope + 1)

		y += slope
		if (y < minY) {
			y = minY
			slope = Math.max(0, slope)
		}
		if (y > maxY) {
			y = maxY
			slope = Math.min(0, slope)
		}
		surface[x] = y
	}
}

/**
 * One-pass soft clamp of 3+ isolated spikes.
 * @param {Int16Array} surface parameter
 * @param {number} W parameter
 * @returns {*} result
 */
function softClampSpikes(surface, W) {
	for (let x = 1; x < W - 1; x++) {
		const dL = surface[x] - surface[x - 1]
		const dR = surface[x] - surface[x + 1]
		if (dL * dR > 0 && Math.abs(dL) >= 3 && Math.abs(dR) >= 3)
			surface[x] = Math.round((surface[x - 1] + surface[x + 1]) / 2)
	}
}

/**
 * Raise enough view columns so ≥ TALL_LAND_FRACTION have thickness ≥ ¼ screen.
 * @param {Int16Array} surface parameter
 * @param {{ W: number, H: number, viewH: number, viewW: number, ox: number, seed: number, footX0: number, footX1: number, baseY: number }} opts parameter
 * @returns {*} result
 */
export function ensureTallLand(surface, {
	W, H, viewH, viewW, ox, seed, footX0, footX1, baseY,
}) {
	const minThick = Math.max(1, Math.ceil(viewH * TALL_LAND_HEIGHT_FRAC))
	const maxSurface = Math.max(2, Math.min(H - 2, viewH - minThick))
	const vx0 = Math.max(0, ox)
	const vx1 = Math.min(W, ox + viewW)
	const footContributes = viewH - baseY >= minThick
	const shoulderL = footX0 - PEDESTAL_SHOULDER
	const shoulderR = footX1 + PEDESTAL_SHOULDER

	/**
	 * @param {number} x column
	 * @returns {boolean} whether column meets tall-land floor
	 */
	const isTall = (x) => {
		if (x >= shoulderL && x < shoulderR) return footContributes
		return viewH - surface[x] >= minThick
	}

	let raisable = 0
	for (let x = vx0; x < vx1; x++)
		if (x < shoulderL || x >= shoulderR) raisable++
	const footSpan = Math.max(0, footX1 - footX0)
	const capacity = raisable + (footContributes ? footSpan + 2 * PEDESTAL_SHOULDER : 0)
	const need = Math.min(Math.ceil((vx1 - vx0) * TALL_LAND_FRACTION), capacity)

	/**
	 * @returns {number} tall column count in view
	 */
	const recount = () => {
		let n = 0
		for (let x = vx0; x < vx1; x++)
			if (isTall(x)) n++
		return n
	}

	let have = recount()
	if (have >= need) return

	const cands = []
	for (let x = vx0; x < vx1; x++) {
		if (x >= shoulderL && x < shoulderR) continue
		if (viewH - surface[x] >= minThick) continue
		cands.push(x)
	}
	cands.sort((a, b) => (viewH - surface[a]) - (viewH - surface[b]) ||
		hash01(a, seed + 3) - hash01(b, seed + 3))

	for (const x of cands) {
		if (have >= need) break
		surface[x] = Math.min(surface[x], maxSurface)
		for (const dx of [-1, 1, -2, 2]) {
			const nx = x + dx
			if (nx < vx0 || nx >= vx1) continue
			if (nx >= shoulderL && nx < shoulderR) continue
			surface[nx] = Math.min(surface[nx], maxSurface + (Math.abs(dx) > 1 ? 1 : 0))
		}
		have = recount()
	}
}

/**
 * Tall-land coverage inside the viewport (for tests / diagnostics).
 * @param {TerrainData} terrain parameter
 * @param {{ viewH: number, viewW: number }} size view size
 * @returns {{ tall: number, total: number, fraction: number, minThick: number }} result
 */
export function tallLandCoverage(terrain, { viewH, viewW }) {
	const { surface, ox } = terrain
	const minThick = Math.max(1, Math.ceil(viewH * TALL_LAND_HEIGHT_FRAC))
	const vx0 = Math.max(0, ox)
	const vx1 = Math.min(surface.length, ox + viewW)
	let tall = 0
	for (let x = vx0; x < vx1; x++)
		if (viewH - surface[x] >= minThick) tall++
	return {
		tall,
		total: vx1 - vx0,
		fraction: vx1 - vx0 ? tall / (vx1 - vx0) : 0,
		minThick,
	}
}

/**
 * 2D value-noise cave carving below surface.
 * @param {Uint8Array} solid flat solid mask
 * @param {Int16Array} surface surface rows
 * @param {number} W width
 * @param {number} H height
 * @param {number} seed seed
 * @returns {*} result
 */
function carveNoiseCaves(solid, surface, W, H, seed) {
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			if (!solid[i] || y <= surface[x] + 1) continue
			const depth = y - surface[x]
			const n = fbm2(x * 0.11, y * 0.13, seed)
			const threshold = 0.58 - Math.min(0.22, depth * 0.018)
			if (n > threshold) solid[i] = 0
		}
}

/**
 * Fractional Brownian motion via hash lattice.
 * @param {number} x parameter
 * @param {number} y parameter
 * @param {number} seed parameter
 * @returns {number} ~[0,1)
 */
function fbm2(x, y, seed) {
	let amp = 0.5
	let freq = 1
	let sum = 0
	let norm = 0
	for (let o = 0; o < 4; o++) {
		sum += amp * valueNoise2(x * freq, y * freq, seed + o * 97)
		norm += amp
		amp *= 0.5
		freq *= 2
	}
	return sum / norm
}

/**
 * Bilinear value noise.
 * @param {number} x parameter
 * @param {number} y parameter
 * @param {number} seed parameter
 * @returns {number} result
 */
function valueNoise2(x, y, seed) {
	const x0 = Math.floor(x)
	const y0 = Math.floor(y)
	const fx = x - x0
	const fy = y - y0
	const v00 = hash01(x0 + seed, y0)
	const v10 = hash01(x0 + 1 + seed, y0)
	const v01 = hash01(x0 + seed, y0 + 1)
	const v11 = hash01(x0 + 1 + seed, y0 + 1)
	const a = v00 + (v10 - v00) * fx
	const b = v01 + (v11 - v01) * fx
	return a + (b - a) * fy
}

/**
 * Cellular automata cleanup — remove isolated solid flecks / fill 1-cell holes.
 * @param {Uint8Array} solid flat solid mask
 * @param {Int16Array} surface surface rows
 * @param {number} W width
 * @param {number} H height
 * @param {number} passes CA iterations
 * @returns {*} result
 */
function cellularCleanup(solid, surface, W, H, passes) {
	const next = new Uint8Array(solid.length)
	for (let pass = 0; pass < passes; pass++) {
		next.set(solid)
		for (let y = 1; y < H - 1; y++)
			for (let x = 1; x < W - 1; x++) {
				const i = y * W + x
				if (y <= surface[x]) continue
				let n = 0
				for (let dy = -1; dy <= 1; dy++)
					for (let dx = -1; dx <= 1; dx++)
						if (dx || dy) n += solid[(y + dy) * W + (x + dx)]
				next[i] = solid[i] ? n >= 3 ? 1 : 0 : n >= 6 ? 1 : 0
			}
		solid.set(next)
	}
}

/**
 * Inject guaranteed connector demos: U-tubes, chambers with necks.
 * @param {Uint8Array} solid solid mask
 * @param {Int16Array} surface surface rows
 * @param {TerrainFeature[]} features feature list to append
 * @param {{ W: number, H: number, seed: number, iconOx: number, iconBaseX0: number, iconBaseX1: number }} opts options
 * @returns {*} result
 */
function injectConnectors(solid, surface, features, { W, H, seed, iconOx, iconBaseX0, iconBaseX1 }) {
	const footX0 = iconOx + iconBaseX0
	const footX1 = iconOx + iconBaseX1
	/**
	 * @param {number} x column
	 * @returns {boolean} overlaps icon keep-out
	 */
	const avoid = (x) => x >= footX0 - 2 && x < footX1 + 2

	const tubeCount = 2 + (hash01(seed, 41) * 2 | 0)
	for (let i = 0; i < tubeCount; i++) {
		const span = 8 + (hash01(seed, 50 + i) * 6 | 0)
		let x0 = 4 + ((hash01(seed * 3, 60 + i) * (W - span - 8)) | 0)
		if (avoid(x0) || avoid(x0 + span))
			x0 = x0 < footX0 ? Math.max(2, footX0 - span - 4) : Math.min(W - span - 2, footX1 + 4)
		if (x0 < 2 || x0 + span >= W - 2) continue

		const mid = Math.min(W - 1, x0 + (span >> 1))
		const top = Math.min(H - 6, surface[mid] + 3 + (hash01(seed, 70 + i) * 3 | 0))
		const depth = 5 + (hash01(seed, 80 + i) * 4 | 0)
		const y1 = Math.min(H - 2, top + depth)
		const wellL = x0 + 1
		const wellR = x0 + span - 2
		carveUTube(solid, surface, W, H, wellL, wellR, top, y1)
		features.push({
			type: 'u_tube',
			x0, x1: x0 + span, y0: top, y1,
			wells: [wellL, wellR],
		})
	}

	const chamberCount = 1 + (hash01(seed, 91) * 2 | 0)
	for (let i = 0; i < chamberCount; i++) {
		const w = 5 + (hash01(seed, 100 + i) * 4 | 0)
		const h = 3 + (hash01(seed, 110 + i) * 3 | 0)
		let cx = 6 + ((hash01(seed, 120 + i) * (W - w - 12)) | 0)
		if (avoid(cx) || avoid(cx + w))
			cx = cx < footX0 ? Math.max(3, footX0 - w - 5) : Math.min(W - w - 3, footX1 + 5)
		const mid = Math.min(W - 1, cx + (w >> 1))
		const cy = Math.min(H - h - 2, surface[mid] + 4 + (hash01(seed, 130 + i) * 5 | 0))
		carveRect(solid, W, H, cx, cy, w, h, 0)
		const neckX = hash01(seed, 140 + i) > 0.5 ? cx - 1 : cx + w
		if (neckX >= 1 && neckX < W - 1) {
			const ny = cy + (h >> 1)
			solid[ny * W + neckX] = 0
			if (ny + 1 < H) solid[(ny + 1) * W + neckX] = 0
			features.push({
				type: 'neck',
				x0: Math.min(cx, neckX), x1: Math.max(cx + w, neckX + 1),
				y0: cy, y1: cy + h,
			})
		}
		features.push({ type: 'chamber', x0: cx, x1: cx + w, y0: cy, y1: cy + h })
	}

	connectNearbyCavities(solid, surface, W, H, seed)
}

/**
 * Carve a U-tube: two shafts + bottom channel.
 * @param {Uint8Array} solid parameter
 * @param {Int16Array} surface parameter
 * @param {number} W width
 * @param {number} H height
 * @param {number} wellL parameter
 * @param {number} wellR parameter
 * @param {number} top parameter
 * @param {number} bottom parameter
 * @returns {*} result
 */
function carveUTube(solid, surface, W, H, wellL, wellR, top, bottom) {
	for (const wx of [wellL, wellR]) {
		if (wx < 0 || wx >= W) continue
		const start = Math.max(top, surface[wx] + 1)
		for (let y = start; y <= bottom && y < H; y++) {
			solid[y * W + wx] = 0
			if (wx + 1 < W) solid[y * W + wx + 1] = 0
		}
	}
	for (let x = wellL; x <= wellR + 1 && x < W; x++)
		for (let y = bottom - 1; y <= bottom && y < H; y++)
			if (y > surface[x]) solid[y * W + x] = 0
}

/**
 * Carve axis-aligned open rectangle.
 * @param {Uint8Array} solid parameter
 * @param {number} W width
 * @param {number} H height
 * @param {number} x0 parameter
 * @param {number} y0 parameter
 * @param {number} w parameter
 * @param {number} h parameter
 * @param {0|1} value parameter
 * @returns {*} result
 */
function carveRect(solid, W, H, x0, y0, w, h, value) {
	for (let y = y0; y < y0 + h && y < H; y++)
		for (let x = x0; x < x0 + w && x < W; x++)
			if (x >= 0 && y >= 0) solid[y * W + x] = value
}

/**
 * Connect nearby underground air pockets with 1-cell corridors.
 * @param {Uint8Array} solid parameter
 * @param {Int16Array} surface parameter
 * @param {number} W width
 * @param {number} H height
 * @param {number} seed seed
 * @returns {*} result
 */
function connectNearbyCavities(solid, surface, W, H, seed) {
	const { regions } = labelCavities(solid, surface, W, H)
	const list = regions.filter(r => r.size >= 8)
	const links = Math.min(4, list.length)
	for (let i = 0; i < links; i++) {
		const a = list[(hash01(seed, 200 + i) * list.length) | 0]
		let best = null
		let bestD = Infinity
		for (const b of list) {
			if (b.id === a.id) continue
			const d = Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy)
			if (d < bestD && d > 3 && d < 28) {
				bestD = d
				best = b
			}
		}
		if (!best) continue
		carveCorridor(solid, surface, W, H, a.cx, a.cy, best.cx, best.cy)
	}
}

const ORTHO = /** @type {const} */ [[1, 0], [-1, 0], [0, 1], [0, -1]]

/**
 * Flood-fill label underground air cavities (id > 0).
 * Accumulates region centroids during the fill — no per-cell lists.
 * @param {Uint8Array} solid flat solid mask
 * @param {Int16Array} surface surface rows
 * @param {number} W width
 * @param {number} H height
 * @returns {{ labels: Int32Array, regions: CavityRegion[] }} result
 */
export function labelCavities(solid, surface, W, H) {
	const labels = new Int32Array(W * H)
	/** @type {CavityRegion[]} */
	const regions = []
	const queue = []
	let next = 1

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			if (solid[i] || labels[i] || y <= surface[x]) continue
			const id = next++
			queue.length = 0
			queue.push(x, y)
			labels[i] = id
			let sx = x
			let sy = y
			let size = 1
			for (let qi = 0; qi < queue.length; qi += 2) {
				const cx = queue[qi]
				const cy = queue[qi + 1]
				for (const [dx, dy] of ORTHO) {
					const nx = cx + dx
					const ny = cy + dy
					if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
					const ni = ny * W + nx
					if (solid[ni] || labels[ni] || ny <= surface[nx]) continue
					labels[ni] = id
					queue.push(nx, ny)
					sx += nx
					sy += ny
					size++
				}
			}
			regions.push({ id, cx: (sx / size) | 0, cy: (sy / size) | 0, size })
		}
	return { labels, regions }
}

/**
 * Manhattan corridor (L-shaped).
 * @param {Uint8Array} solid parameter
 * @param {Int16Array} surface parameter
 * @param {number} W width
 * @param {number} H height
 * @param {number} x0 parameter
 * @param {number} y0 parameter
 * @param {number} x1 parameter
 * @param {number} y1 parameter
 * @returns {*} result
 */
function carveCorridor(solid, surface, W, H, x0, y0, x1, y1) {
	let x = x0
	let y = y0
	while (x !== x1) {
		if (x >= 0 && x < W && y >= 0 && y < H && y > surface[x]) solid[y * W + x] = 0
		x += x1 > x ? 1 : -1
	}
	while (y !== y1) {
		if (x >= 0 && x < W && y >= 0 && y < H && y > surface[x]) solid[y * W + x] = 0
		y += y1 > y ? 1 : -1
	}
	if (x >= 0 && x < W && y >= 0 && y < H && y > surface[x]) solid[y * W + x] = 0
}

/**
 * Keep icon pedestal span on land at `baseY` and ensure that crust cell is soil.
 * @param {Uint8Array} solid parameter
 * @param {Int16Array} surface parameter
 * @param {number} W width
 * @param {number} H height
 * @param {number} footX0 parameter
 * @param {number} footX1 parameter
 * @param {number} baseY parameter
 * @returns {*} result
 */
function carveIconFootprint(solid, surface, W, H, footX0, footX1, baseY) {
	for (let x = footX0; x < footX1; x++) {
		if (x < 0 || x >= W) continue
		surface[x] = baseY
		for (let y = 0; y < baseY; y++)
			solid[y * W + x] = 0
		if (baseY < H) solid[baseY * W + x] = 1
	}
}

/**
 * Pick outline chars for surface columns from neighbor deltas.
 * @param {Int16Array} surface parameter
 * @param {number} W parameter
 * @returns {string[]} result
 */
function buildSurfaceChars(surface, W) {
	const chars = Array(W)
	for (let x = 0; x < W; x++) {
		const y = surface[x]
		const left = x > 0 ? surface[x - 1] : y
		const right = x < W - 1 ? surface[x + 1] : y
		const dL = y - left
		const dR = right - y

		if (dL === 0 && dR === 0)
			chars[x] = (x + y) & 1 ? TERRAIN_CH.FLAT_ALT : TERRAIN_CH.FLAT
		else if (dR > 0 || dL < 0)
			chars[x] = Math.abs(dR || dL) >= 2 ? TERRAIN_CH.WALL : TERRAIN_CH.SLOPE_UP
		else if (dR < 0 || dL > 0)
			chars[x] = Math.abs(dR || dL) >= 2 ? TERRAIN_CH.WALL : TERRAIN_CH.SLOPE_DOWN
		else
			chars[x] = TERRAIN_CH.FLAT
	}
	return chars
}

/**
 * Character for a solid cell's visible outline (air-adjacent).
 * Interior solid returns null (not drawn).
 * @param {Uint8Array} solid flat solid mask
 * @param {number} x column
 * @param {number} y row
 * @param {number} W world width
 * @param {number} H world height
 * @param {Int16Array} surface surface rows
 * @returns {string | null} outline glyph or null
 */
export function outlineChar(solid, x, y, W, H, surface) {
	const i = y * W + x
	if (!solid[i] || y === surface[x]) return null

	/**
	 * @param {number} nx column
	 * @param {number} ny row
	 * @returns {boolean} air / OOB
	 */
	const air = (nx, ny) =>
		nx < 0 || ny < 0 || nx >= W || ny >= H || !solid[ny * W + nx]

	const up = air(x, y - 1)
	const down = air(x, y + 1)
	const left = air(x - 1, y)
	const right = air(x + 1, y)
	if (!(up || down || left || right)) return null

	if (left && right && !up && !down) return TERRAIN_CH.WALL
	if (up && down && !left && !right) return TERRAIN_CH.FLOOR
	if (up && right && !down && !left) return TERRAIN_CH.SLOPE_DOWN
	if (up && left && !down && !right) return TERRAIN_CH.SLOPE_UP
	if (down && right && !up && !left) return TERRAIN_CH.SLOPE_UP
	if (down && left && !up && !right) return TERRAIN_CH.SLOPE_DOWN
	if (left || right) return TERRAIN_CH.WALL
	if (up) return TERRAIN_CH.CEIL
	if (down) return TERRAIN_CH.FLOOR
	return TERRAIN_CH.WALL
}

/**
 * Count underground air cavities (for tests).
 * @param {TerrainData} terrain parameter
 * @returns {{ count: number, sizes: number[], hasUTube: boolean, hasChamber: boolean }} result
 */
export function analyzeTerrain(terrain) {
	const { solid, surface, features, worldW: W, worldH: H } = terrain
	const { regions } = labelCavities(solid, surface, W, H)
	return {
		count: regions.length,
		sizes: regions.map(r => r.size).sort((a, b) => b - a),
		hasUTube: features.some(f => f.type === 'u_tube'),
		hasChamber: features.some(f => f.type === 'chamber' || f.type === 'neck'),
	}
}

/**
 * Rough periodicity check: surface should not look like a sine.
 * @param {Int16Array} surface parameter
 * @returns {number} max |autocorr| for lags 4..12 (lower = less periodic)
 */
export function surfacePeriodicityScore(surface) {
	const W = surface.length
	let mean = 0
	for (let i = 0; i < W; i++) mean += surface[i]
	mean /= W
	let varSum = 0
	for (let i = 0; i < W; i++) varSum += (surface[i] - mean) ** 2
	if (varSum < 1e-6) return 1
	let maxCorr = 0
	for (let lag = 4; lag <= 12; lag++) {
		let c = 0
		for (let i = 0; i < W - lag; i++)
			c += (surface[i] - mean) * (surface[i + lag] - mean)
		maxCorr = Math.max(maxCorr, Math.abs(c / varSum))
	}
	return maxCorr
}
