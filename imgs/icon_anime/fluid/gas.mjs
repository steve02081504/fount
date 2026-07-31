/**
 * Air regions (Boyle), global wind, gas velocity field.
 */

import { hash01 } from '../hash.mjs'

import { P_ATM, RHO_G, LIQ_DRAW, isBlockMat } from './mat.mjs'
import { scratch, idx, inWorld } from './world.mjs'

/** @typedef {import('./world.mjs').FluidWorld} FluidWorld
 * @typedef {{
 *   id: number,
 *   openToAtm: boolean,
 *   airCells: number,
 *   gasAmount: number,
 *   pressure: number,
 * }} AirRegion
 */

/** Mean global wind amplitude (cells / tick). */
export const WIND_BASE = 0.38
/** Gust / turbulence amplitude on top of the drifting mean. */
export const WIND_GUST = 0.28
/** Boundary-layer shear: u ∝ altitude^power (stronger aloft). */
export const WIND_SHEAR_POWER = 0.55
/** Ticks per intermittent gust window. */
const WIND_GUST_PERIOD = 41
/** Blend of cell gas toward wind / pressure target each tick. */
export const GAS_BLEND = 0.28
/** Continuity boost when horizontal passage is constricted. */
export const GAS_NOZZLE = 1.55

const AIR_CELL = 1

/**
 * Cell is air-like for region flood-fill (not block, liquid below draw).
 * @param {FluidWorld} w world
 * @param {number} i flat index
 * @returns {boolean} air cell
 */
const isAirCell = (w, i) => !isBlockMat(w.mat[i]) && w.liq[i] < LIQ_DRAW

/**
 * Label air regions with conserved gas mass transfer across topology changes.
 * Open-to-atmosphere regions get P = P_ATM; sealed use Boyle.
 * Double-buffers `regionId` via `scratch.prevRegionId`.
 * @param {FluidWorld} w world
 * @returns {void}
 */
export const labelAirRegions = (w) => {
	const { worldW: W, worldH: H } = w
	const n = W * H
	const oldId = w.regionId
	const regionId = scratch(w, 'prevRegionId', n, Int32Array)
	regionId.fill(0)

	const oldRegions = w.regions
	const nextRegions = new Map()
	let next = 1
	const q = w.floodQ
	q.length = 0

	/**
	 * Seed a flood cell into the region if still unlabeled air.
	 * @param {number} x column
	 * @param {number} y row
	 * @param {number} id region id
	 * @param {AirRegion} region region
	 * @returns {void}
	 */
	const seed = (x, y, id, region) => {
		if (x < 0 || y < 0 || x >= W || y >= H) return
		const i = y * W + x
		if (regionId[i] || !isAirCell(w, i)) return
		regionId[i] = id
		region.airCells++
		q.push(x, y)
	}

	/**
	 * BFS expand from queue until drained.
	 * @param {number} id region id
	 * @param {AirRegion} region region
	 * @returns {void}
	 */
	const flood = (id, region) => {
		for (let qi = 0; qi < q.length; qi += 2) {
			const x = q[qi]
			const y = q[qi + 1]
			seed(x - 1, y, id, region)
			seed(x + 1, y, id, region)
			seed(x, y - 1, id, region)
			seed(x, y + 1, id, region)
		}
	}

	const openId = next++
	const openRegion = { id: openId, openToAtm: true, airCells: 0, gasAmount: 0, pressure: P_ATM }
	for (let x = 0; x < W; x++) seed(x, 0, openId, openRegion)
	for (let y = 1; y < H; y++) {
		seed(0, y, openId, openRegion)
		seed(W - 1, y, openId, openRegion)
	}
	flood(openId, openRegion)
	if (openRegion.airCells > 0) {
		openRegion.gasAmount = openRegion.airCells * AIR_CELL * P_ATM
		openRegion.pressure = P_ATM
		nextRegions.set(openId, openRegion)
	}

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			if (regionId[i] || !isAirCell(w, i)) continue
			const id = next++
			const region = { id, openToAtm: false, airCells: 0, gasAmount: 0, pressure: P_ATM }
			q.length = 0
			seed(x, y, id, region)
			flood(id, region)
			nextRegions.set(id, region)
		}

	const overlap = new Map()
	for (let i = 0; i < n; i++) {
		const o = oldId[i]
		const nid = regionId[i]
		if (!o || !nid) continue
		let row = overlap.get(o)
		if (!row) overlap.set(o, row = new Map())
		row.set(nid, (row.get(nid) || 0) + 1)
	}

	for (const region of nextRegions.values()) {
		if (region.openToAtm) {
			region.gasAmount = region.airCells * AIR_CELL * P_ATM
			region.pressure = P_ATM
			continue
		}
		let gas = 0
		let got = false
		for (const [oldRid, row] of overlap) {
			const cells = row.get(region.id)
			if (!cells) continue
			const old = oldRegions.get(oldRid)
			if (!old) continue
			got = true
			let oldTotal = 0
			for (const c of row.values()) oldTotal += c
			gas += old.gasAmount * (cells / Math.max(1, oldTotal))
		}
		if (!got) gas = region.airCells * AIR_CELL * P_ATM
		region.gasAmount = gas
		region.pressure = Math.max(0.05, Math.min(8, gas / Math.max(AIR_CELL * 0.25, region.airCells * AIR_CELL)))
	}

	w.scratch.prevRegionId = oldId
	w.regionId = regionId
	w.regions = nextRegions
}

/**
 * Pressure at cell from its air region (liquid cells use overlying air or atm).
 * @param {FluidWorld} w world
 * @param {number} x column
 * @param {number} y row
 * @returns {number} pressure
 */
export const pressureAt = (w, x, y) => {
	if (!inWorld(w, x, y)) return P_ATM
	const i = idx(w, x, y)
	const rid = w.regionId[i]
	if (rid) return w.regions.get(rid)?.pressure ?? P_ATM
	for (let yy = y - 1; yy >= 0; yy--) {
		const ii = idx(w, x, yy)
		if (isBlockMat(w.mat[ii])) break
		const r2 = w.regionId[ii]
		if (r2) return w.regions.get(r2)?.pressure ?? P_ATM
	}
	return P_ATM
}

/**
 * Smooth 1D value noise in [-1, 1].
 * @param {number} t continuous coordinate
 * @param {number} seed lattice salt
 * @returns {number} noise
 */
const valueNoise1d = (t, seed) => {
	const i = Math.floor(t)
	const f = t - i
	const u = f * f * f * (f * (f * 6 - 15) + 10)
	const a = hash01(seed, i) * 2 - 1
	const b = hash01(seed, i + 1) * 2 - 1
	return a + (b - a) * u
}

/**
 * Pink-ish 1D fBm in ~[-1, 1].
 * @param {number} t continuous coordinate
 * @param {number} seed lattice salt
 * @param {number} [octaves=4] octave count
 * @returns {number} noise
 */
const fbm1d = (t, seed, octaves = 4) => {
	let v = 0, amp = 1, freq = 1, norm = 0
	for (let o = 0; o < octaves; o++) {
		v += amp * valueNoise1d(t * freq, seed + o * 97)
		norm += amp
		amp *= 0.5
		freq *= 2.03
	}
	return v / norm
}

/**
 * Time-varying global wind scalar (positive → rightward).
 * @param {number} time tick
 * @param {number} [seed=0] scene seed
 * @returns {number} wind
 */
export const globalWindAt = (time, seed = 0) => {
	const t0 = hash01(seed, 91) * 100
	const synoptic = fbm1d(time * 0.006 + t0, seed + 11, 3)
	const meso = fbm1d(time * 0.022 + t0 * 1.3, seed + 29, 4)
	const micro = fbm1d(time * 0.07 + t0 * 0.7, seed + 47, 5)
	const base = WIND_BASE * (0.55 * synoptic + 0.3 * meso + 0.15 * micro) * 1.65

	const gw = Math.floor(time / WIND_GUST_PERIOD)
	const gHash = hash01(seed + 71, gw)
	if (gHash <= 0.68) return base

	const phase = ((time % WIND_GUST_PERIOD) + WIND_GUST_PERIOD) % WIND_GUST_PERIOD / WIND_GUST_PERIOD
	const rise = 0.22
	const env = phase < rise ? phase / rise : Math.max(0, 1 - (phase - rise) / (1 - rise))
	return base + (base >= 0 ? 1 : -1) * (gHash - 0.68) / 0.32 * WIND_GUST * 1.55 * env * env
}

/**
 * Height-sheared wind: stronger aloft, weaker near ground.
 * @param {number} y world row
 * @param {number} worldH world height
 * @param {number} time tick
 * @param {number} [seed=0] scene seed
 * @returns {number} horizontal wind
 */
export const windProfileAt = (y, worldH, time, seed = 0) => {
	const alt = 1 - Math.min(1, Math.max(0, y / Math.max(1, worldH - 1)))
	return globalWindAt(time, seed) * (0.28 + 0.72 * alt ** WIND_SHEAR_POWER)
}

/**
 * Sample gas velocity at a world point (nearest cell).
 * @param {FluidWorld} w world
 * @param {number} x column
 * @param {number} y row
 * @returns {{ ux: number, uy: number }} velocity
 */
export const gasVelocityAt = (w, x, y) => {
	const cx = x | 0
	const cy = y | 0
	if (!inWorld(w, cx, cy)) return { ux: 0, uy: 0 }
	const i = idx(w, cx, cy)
	return { ux: w.gasUx[i], uy: w.gasUy[i] }
}

/**
 * Dynamic pressure proxy ½ρu².
 * @param {number} ux horizontal speed
 * @param {number} [uy=0] vertical speed
 * @returns {number} dynamic pressure
 */
export const dynamicPressure = (ux, uy = 0) => 0.5 * RHO_G * (ux * ux + uy * uy)

/**
 * Bernoulli static-pressure proxy: P₀ − ½ρu² (clamped).
 * @param {FluidWorld} w world
 * @param {number} x column
 * @param {number} y row
 * @returns {number} static pressure
 */
export const staticPressureAt = (w, x, y) => {
	const { ux, uy } = gasVelocityAt(w, x, y)
	return Math.max(0.05, pressureAt(w, x, y) - dynamicPressure(ux, uy))
}

/**
 * Fill free-span lengths along columns (vert) or rows (horiz) in O(WH).
 * @param {Uint8Array} blocked 1 = blocked
 * @param {number} W width
 * @param {number} H height
 * @param {Uint16Array} outVert vertical free span
 * @param {Uint16Array} outHoriz horizontal free span
 * @returns {void}
 */
const fillGasSpans = (blocked, W, H, outVert, outHoriz) => {
	for (let x = 0; x < W; x++) {
		let y = 0
		while (y < H) {
			while (y < H && blocked[y * W + x]) {
				outVert[y * W + x] = 0
				y++
			}
			const y0 = y
			while (y < H && !blocked[y * W + x]) y++
			const span = y - y0
			for (let yy = y0; yy < y; yy++) outVert[yy * W + x] = span
		}
	}
	for (let y = 0; y < H; y++) {
		let x = 0
		const row = y * W
		while (x < W) {
			while (x < W && blocked[row + x]) {
				outHoriz[row + x] = 0
				x++
			}
			const x0 = x
			while (x < W && !blocked[row + x]) x++
			const span = x - x0
			for (let xx = x0; xx < x; xx++) outHoriz[row + xx] = span
		}
	}
}

/**
 * Advance open-air / cavity gas velocity: wind shear, nozzle continuity, wall slip.
 * @param {FluidWorld} w world
 * @param {{ time?: number, seed?: number, forceWind?: number }} [opts] drive options
 * @returns {void}
 */
export const stepGas = (w, opts = {}) => {
	const time = opts.time ?? w.gasTime
	const seed = opts.seed ?? 0
	const forced = opts.forceWind
	w.gasTime = time + 1
	labelAirRegions(w)

	const { worldW: W, worldH: H, mat, liq, gasUx, gasUy, regionId, regions } = w
	const n = W * H
	const nextUx = scratch(w, 'gasNextUx', n, Float32Array)
	const nextUy = scratch(w, 'gasNextUy', n, Float32Array)
	const blocked = scratch(w, 'gasBlocked', n, Uint8Array)
	const vertSpan = scratch(w, 'gasVertSpan', n, Uint16Array)
	const horizSpan = scratch(w, 'gasHorizSpan', n, Uint16Array)
	nextUx.fill(0)
	nextUy.fill(0)

	for (let i = 0; i < n; i++)
		blocked[i] = isBlockMat(mat[i]) || liq[i] >= LIQ_DRAW ? 1 : 0
	fillGasSpans(blocked, W, H, vertSpan, horizSpan)

	/**
	 * Height-sheared drive wind at row y.
	 * @param {number} y row
	 * @returns {number} ux drive
	 */
	const driveWind = (y) => {
		const alt = 1 - Math.min(1, Math.max(0, y / Math.max(1, H - 1)))
		const shear = 0.28 + 0.72 * alt ** WIND_SHEAR_POWER
		return forced !== undefined ? forced * shear : windProfileAt(y, H, time, seed)
	}

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			if (blocked[i]) continue

			const region = regionId[i] ? regions.get(regionId[i]) : null
			const open = !region || region.openToAtm

			let tx = open ? driveWind(y) : 0
			let ty = 0

			const openL = x > 0 && !blocked[i - 1]
			const openR = x + 1 < W && !blocked[i + 1]
			const openU = y > 0 && !blocked[i - W]
			const openD = y + 1 < H && !blocked[i + W]

			const span = vertSpan[i]
			if (span <= 4) {
				const wide = Math.max(span, openL ? vertSpan[i - 1] : span, openR ? vertSpan[i + 1] : span)
				if (wide > span && Math.abs(tx) > 0.02)
					tx *= Math.min(GAS_NOZZLE * 1.4, wide / span)
			}
			const hSpan = horizSpan[i]
			if (hSpan <= 4) {
				const wide = Math.max(hSpan, openU ? horizSpan[i - W] : hSpan, openD ? horizSpan[i + W] : hSpan)
				if (wide > hSpan && Math.abs(ty) > 0.02)
					ty *= Math.min(GAS_NOZZLE * 1.4, wide / hSpan)
			}

			let ux = gasUx[i] + (tx - gasUx[i]) * GAS_BLEND
			let uy = gasUy[i] + (ty - gasUy[i]) * GAS_BLEND

			if (!openL && ux < 0) ux = 0
			if (!openR && ux > 0) ux = 0
			if (!openU && uy < 0) uy = 0
			if (!openD && uy > 0) uy = 0

			let sumUx = ux
			let sumUy = uy
			let count = 1
			if (openL) { sumUx += gasUx[i - 1]; sumUy += gasUy[i - 1]; count++ }
			if (openR) { sumUx += gasUx[i + 1]; sumUy += gasUy[i + 1]; count++ }
			if (openU) { sumUx += gasUx[i - W]; sumUy += gasUy[i - W]; count++ }
			if (openD) { sumUx += gasUx[i + W]; sumUy += gasUy[i + W]; count++ }
			ux = ux * 0.65 + (sumUx / count) * 0.35
			uy = uy * 0.65 + (sumUy / count) * 0.35

			if (!open) {
				ux *= 0.85
				uy *= 0.85
			}

			nextUx[i] = Math.max(-2.5, Math.min(2.5, ux))
			nextUy[i] = Math.max(-2.5, Math.min(2.5, uy))
		}

	gasUx.set(nextUx)
	gasUy.set(nextUy)
}

/**
 * Total sealed gas amount (for tests).
 * @param {FluidWorld} w world
 * @returns {number} sealed gas mass
 */
export const totalSealedGas = (w) => {
	let g = 0
	for (const r of w.regions.values())
		if (!r.openToAtm) g += r.gasAmount
	return g
}
