/**
 * Air regions (Boyle), global wind, gas velocity field.
 * Caller must `labelAirRegions` before `stepGas` / pressure queries.
 *
 * Open air: P = P_ATM + ATM_HYDRO·y; sealed: isothermal Boyle mean + ATM_HYDRO·(y−yMean).
 * Velocity: wind shear + nozzle continuity + neighbor static-ΔP (Bernoulli feedback).
 * No 2D ∇·u=0 projection — pointer vortices / updrafts are intentional sources.
 */

import { hash01, fbm1d } from '../hash.mjs'

import {
	P_ATM, RHO_AIR, ATM_HYDRO, GAS_DP_DRIVE, LIQ_DRAW, isBlockMat,
} from './mat.mjs'
import { scratch, idx, inWorld, floodClear, floodPush } from './world.mjs'

/** @typedef {import('./world.mjs').FluidWorld} FluidWorld
 * @typedef {{
 *   id: number,
 *   openToAtm: boolean,
 *   airCells: number,
 *   sumY: number,
 *   yMean: number,
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
/** Soft clamp on cell gas speed (cells / tick). */
export const GAS_SPEED_MAX = 5

const AIR_CELL = 1

/**
 * Open-air hydrostatic pressure at row `y` (y↓ → P↑).
 * @param {number} y world row
 * @returns {number} pressure
 */
const openHydroPressure = (y) => P_ATM + ATM_HYDRO * y

/**
 * Sealed-cavity hydrostatic pressure at row `y` around Boyle mean.
 * @param {AirRegion} region sealed cavity region
 * @param {number} y world row
 * @returns {number} pressure
 */
const sealedHydroPressure = (region, y) =>
	Math.max(0.05, region.pressure + ATM_HYDRO * (y - region.yMean))

/**
 * Cell is air-like for region flood-fill / gas occupancy.
 * @param {FluidWorld} world fluid world
 * @param {number} cell flat index
 * @returns {boolean} air cell
 */
export const isAirCell = (world, cell) => !isBlockMat(world.mat[cell]) && world.liq[cell] < LIQ_DRAW

/**
 * Fill blocked mask: 1 where gas cannot occupy.
 * @param {FluidWorld} world fluid world
 * @param {Uint8Array} blocked output mask
 * @returns {void}
 */
export const fillBlocked = (world, blocked) => {
	const { mat, liq } = world
	for (let cell = 0; cell < blocked.length; cell++)
		blocked[cell] = isBlockMat(mat[cell]) || liq[cell] >= LIQ_DRAW ? 1 : 0
}

/**
 * Reset / allocate an air-region record (reuses pooled objects when possible).
 * @param {AirRegion[]} pool free list
 * @param {number} id region id
 * @param {boolean} openToAtm open to atmosphere?
 * @returns {AirRegion} region
 */
const takeRegion = (pool, id, openToAtm) => {
	const region = pool.pop() || {
		id: 0, openToAtm: false, airCells: 0, sumY: 0, yMean: 0,
		gasAmount: 0, pressure: P_ATM,
	}
	region.id = id
	region.openToAtm = openToAtm
	region.airCells = 0
	region.sumY = 0
	region.yMean = 0
	region.gasAmount = 0
	region.pressure = P_ATM
	return region
}

/**
 * Label air regions with conserved gas mass transfer across topology changes.
 * Open-to-atmosphere regions get P = P_ATM; sealed use Boyle mean + yMean.
 * Double-buffers `regionId` via `scratch.prevRegionId`.
 * Regions are a dense id-indexed array (`regions[id]`; slot 0 unused).
 * @param {FluidWorld} world fluid world
 * @returns {void}
 */
export const labelAirRegions = (world) => {
	const { worldW: W, worldH: H } = world
	const n = W * H
	const oldId = world.regionId
	const regionId = scratch(world, 'prevRegionId', n, Int32Array)
	regionId.fill(0)

	const oldRegions = world.regions
	/** @type {AirRegion[]} */
	const regionPool = /** @type {AirRegion[]} */ world.scratch.regionPool ??= []
	// Snapshot Boyle mass before pooling — objects may be reused for nextRegions.
	const oldGas = scratch(world, 'oldRegionGas', Math.max(oldRegions.length, 1), Float32Array)
	oldGas.fill(0)
	for (let id = 1; id < oldRegions.length; id++) {
		const r = oldRegions[id]
		if (!r) continue
		oldGas[id] = r.gasAmount
		regionPool.push(r)
	}

	/** @type {(AirRegion | undefined)[]} */
	const nextRegions = []
	let next = 1
	floodClear(world)

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
		const cell = y * W + x
		if (regionId[cell] || !isAirCell(world, cell)) return
		regionId[cell] = id
		region.airCells++
		region.sumY += y
		floodPush(world, x, y)
	}

	/**
	 * BFS expand from queue until drained.
	 * @param {number} id region id
	 * @param {AirRegion} region region
	 * @returns {void}
	 */
	const flood = (id, region) => {
		for (let qi = 0; qi < world.floodQ.length; qi += 2) {
			const x = world.floodQ[qi]
			const y = world.floodQ[qi + 1]
			seed(x - 1, y, id, region)
			seed(x + 1, y, id, region)
			seed(x, y - 1, id, region)
			seed(x, y + 1, id, region)
		}
	}

	const openId = next++
	const openRegion = takeRegion(regionPool, openId, true)
	for (let x = 0; x < W; x++) seed(x, 0, openId, openRegion)
	for (let y = 1; y < H; y++) {
		seed(0, y, openId, openRegion)
		seed(W - 1, y, openId, openRegion)
	}
	flood(openId, openRegion)
	if (openRegion.airCells > 0) {
		openRegion.yMean = openRegion.sumY / openRegion.airCells
		openRegion.gasAmount = openRegion.airCells * AIR_CELL * P_ATM
		openRegion.pressure = P_ATM
		nextRegions[openId] = openRegion
	}
	else regionPool.push(openRegion)

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (regionId[cell] || !isAirCell(world, cell)) continue
			const id = next++
			const region = takeRegion(regionPool, id, false)
			floodClear(world)
			seed(x, y, id, region)
			flood(id, region)
			region.yMean = region.airCells > 0 ? region.sumY / region.airCells : 0
			nextRegions[id] = region
		}

	// Open region already reset to ATM above; Boyle overlap only for sealed cavities.
	let hasSealed = false
	for (let id = 1; id < nextRegions.length; id++) {
		const region = nextRegions[id]
		if (region && !region.openToAtm) hasSealed = true
	}

	if (hasSealed) {
		/** @type {Map<number, number>} */
		const overlap = new Map()
		const oldTotal = scratch(world, 'oldRegionTotal', Math.max(oldRegions.length, 1), Float32Array)
		oldTotal.fill(0)
		for (let cell = 0; cell < n; cell++) {
			const old = oldId[cell]
			const nid = regionId[cell]
			if (!old || !nid) continue
			const region = nextRegions[nid]
			if (!region || region.openToAtm) continue
			const key = (old << 16) | nid
			overlap.set(key, (overlap.get(key) || 0) + 1)
			oldTotal[old]++
		}

		const sealedGas = scratch(world, 'sealedGasAcc', nextRegions.length, Float32Array)
		const sealedGot = scratch(world, 'sealedGasGot', nextRegions.length, Uint8Array)
		sealedGas.fill(0)
		sealedGot.fill(0)
		for (const [key, cells] of overlap) {
			const nid = key & 0xffff
			const oldRid = key >>> 16
			if (!oldRegions[oldRid]) continue
			sealedGot[nid] = 1
			sealedGas[nid] += oldGas[oldRid] * (cells / Math.max(1, oldTotal[oldRid]))
		}
		for (let id = 1; id < nextRegions.length; id++) {
			const region = nextRegions[id]
			if (!region || region.openToAtm) continue
			const gas = sealedGot[id] ? sealedGas[id] : region.airCells * AIR_CELL * P_ATM
			region.gasAmount = gas
			region.pressure = Math.max(0.05, Math.min(8, gas / Math.max(AIR_CELL * 0.25, region.airCells * AIR_CELL)))
		}
	}

	world.scratch.prevRegionId = oldId
	world.regionId = regionId
	world.regions = nextRegions
	world.airDirty = false
	world.gasGeomDirty = true
}

/**
 * Thermodynamic / hydrostatic gas pressure at a cell (no dynamic Bernoulli term).
 * Open air: P_ATM + ATM_HYDRO·y.
 * Sealed: Boyle mean + ATM_HYDRO·(y − yMean) so the region average stays Boyle.
 * Liquid cells use overlying air (or atm).
 * @param {FluidWorld} world fluid world
 * @param {number} x column
 * @param {number} y row
 * @returns {number} pressure
 */
export const pressureAt = (world, x, y) => {
	if (!inWorld(world, x, y)) return openHydroPressure(Math.max(0, y))
	const cell = idx(world, x, y)
	const rid = world.regionId[cell]
	if (rid) {
		const region = world.regions[rid]
		return region.openToAtm ? openHydroPressure(y) : sealedHydroPressure(region, y)
	}
	for (let yy = y - 1; yy >= 0; yy--) {
		const above = idx(world, x, yy)
		if (isBlockMat(world.mat[above])) break
		const aboveRid = world.regionId[above]
		if (aboveRid) {
			const region = world.regions[aboveRid]
			return region.openToAtm ? openHydroPressure(yy) : sealedHydroPressure(region, yy)
		}
	}
	return openHydroPressure(y)
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
 * Height shear factor in (0, 1]: stronger aloft.
 * @param {number} y world row
 * @param {number} worldH world height
 * @returns {number} shear
 */
const windShear = (y, worldH) => {
	const alt = 1 - Math.min(1, Math.max(0, y / Math.max(1, worldH - 1)))
	return 0.28 + 0.72 * alt ** WIND_SHEAR_POWER
}

/**
 * Height-sheared wind: stronger aloft, weaker near ground.
 * @param {number} y world row
 * @param {number} worldH world height
 * @param {number} time tick
 * @param {number} [seed=0] scene seed
 * @returns {number} horizontal wind
 */
export const windProfileAt = (y, worldH, time, seed = 0) =>
	globalWindAt(time, seed) * windShear(y, worldH)

/**
 * Sample gas velocity at a world point (nearest cell).
 * @param {FluidWorld} world fluid world
 * @param {number} x column
 * @param {number} y row
 * @returns {{ ux: number, uy: number }} velocity
 */
export const gasVelocityAt = (world, x, y) => {
	const cx = x | 0
	const cy = y | 0
	if (!inWorld(world, cx, cy)) return { ux: 0, uy: 0 }
	const cell = idx(world, cx, cy)
	return { ux: world.gasUx[cell], uy: world.gasUy[cell] }
}

/**
 * Horizontal gas velocity at a world point (no alloc).
 * @param {FluidWorld} world fluid world
 * @param {number} x column
 * @param {number} y row
 * @returns {number} ux
 */
export const gasUxAt = (world, x, y) => {
	const cx = x | 0
	const cy = y | 0
	if (!inWorld(world, cx, cy)) return 0
	return world.gasUx[idx(world, cx, cy)]
}

/**
 * Dynamic pressure proxy ½ρu².
 * @param {number} ux horizontal speed
 * @param {number} [uy=0] vertical speed
 * @returns {number} dynamic pressure
 */
export const dynamicPressure = (ux, uy = 0) => 0.5 * RHO_AIR * (ux * ux + uy * uy)

/**
 * Bernoulli static pressure: thermodynamic P − ½ρu² (clamped).
 * Used both as a query and as the field that drives neighbor ΔP in `stepGas`.
 * @param {FluidWorld} world fluid world
 * @param {number} x column
 * @param {number} y row
 * @returns {number} static pressure
 */
export const staticPressureAt = (world, x, y) => {
	const cx = x | 0
	const cy = y | 0
	if (!inWorld(world, cx, cy)) return Math.max(0.05, pressureAt(world, x, y))
	const cell = idx(world, cx, cy)
	return Math.max(0.05, pressureAt(world, x, y) - dynamicPressure(world.gasUx[cell], world.gasUy[cell]))
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
 * Advance open-air / cavity gas velocity: wind shear, nozzle continuity,
 * wall slip, and neighbor static-pressure ΔP (Bernoulli suction feedback).
 * Optional `driveUx`/`driveUy` add local target velocity (pointer wind / vortex).
 * Requires a prior `labelAirRegions` for the current mat/liq topology.
 * @param {FluidWorld} world fluid world
 * @param {{
 *   time?: number,
 *   seed?: number,
 *   forceWind?: number,
 *   driveUx?: Float32Array,
 *   driveUy?: Float32Array,
 * }} [opts] drive options
 * @returns {void}
 */
export const stepGas = (world, opts = {}) => {
	const time = opts.time ?? world.gasTime
	const seed = opts.seed ?? 0
	const forced = opts.forceWind
	const driveUx = opts.driveUx
	const driveUy = opts.driveUy
	world.gasTime = time + 1

	const { worldW: W, worldH: H, regionId, regions } = world
	const n = W * H
	const gasUx = world.gasUx
	const gasUy = world.gasUy
	const nextUx = scratch(world, 'gasNextUx', n, Float32Array)
	const nextUy = scratch(world, 'gasNextUy', n, Float32Array)
	const blocked = scratch(world, 'gasBlocked', n, Uint8Array)
	const vertSpan = scratch(world, 'gasVertSpan', n, Uint16Array)
	const horizSpan = scratch(world, 'gasHorizSpan', n, Uint16Array)
	const staticP = scratch(world, 'gasStaticP', n, Float32Array)
	// No nextU*.fill(0) — blocked cells are zeroed in the velocity pass below.

	if (world.gasGeomDirty) {
		fillBlocked(world, blocked)
		fillGasSpans(blocked, W, H, vertSpan, horizSpan)
		world.gasGeomDirty = false
	}

	// Cache synoptic wind once per tick — shear only varies by row.
	const wind0 = forced !== undefined ? forced : globalWindAt(time, seed)
	let maxUpdraft = 0

	// Static pressure field from current velocity (Bernoulli) for ΔP drive.
	for (let y = 0; y < H; y++) {
		const openHydro = openHydroPressure(y)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (blocked[cell]) {
				staticP[cell] = 0
				continue
			}
			const rid = regionId[cell]
			const region = rid ? regions[rid] : null
			const thermo = !region || region.openToAtm
				? openHydro
				: sealedHydroPressure(region, y)
			staticP[cell] = Math.max(0.05, thermo - dynamicPressure(gasUx[cell], gasUy[cell]))
		}
	}

	for (let y = 0; y < H; y++) {
		const drive = wind0 * windShear(y, H)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (blocked[cell]) {
				nextUx[cell] = 0
				nextUy[cell] = 0
				continue
			}

			const region = regionId[cell] ? regions[regionId[cell]] : null
			const open = !region || region.openToAtm
			const localDrive = driveUx
				? Math.abs(driveUx[cell]) + Math.abs(driveUy[cell])
				: 0

			let tx = open ? drive : 0
			let ty = 0
			if (driveUx) {
				tx += driveUx[cell]
				ty += driveUy[cell]
			}

			const openL = x > 0 && !blocked[cell - 1]
			const openR = x + 1 < W && !blocked[cell + 1]
			const openU = y > 0 && !blocked[cell - W]
			const openD = y + 1 < H && !blocked[cell + W]

			// Flow toward lower static P: accel along (dx,dy) ∝ (pSelf − pNeighbor).
			const p0 = staticP[cell]
			if (openL) tx += -1 * (p0 - staticP[cell - 1]) * GAS_DP_DRIVE
			if (openR) tx += (p0 - staticP[cell + 1]) * GAS_DP_DRIVE
			if (openU) ty += -1 * (p0 - staticP[cell - W]) * GAS_DP_DRIVE
			if (openD) ty += (p0 - staticP[cell + W]) * GAS_DP_DRIVE

			// Continuity (A·v) through duct throats.
			const span = vertSpan[cell]
			if (span <= 4) {
				const wide = Math.max(span, openL ? vertSpan[cell - 1] : span, openR ? vertSpan[cell + 1] : span)
				if (wide > span && Math.abs(tx) > 0.02)
					tx *= Math.min(GAS_NOZZLE * 1.4, wide / span)
			}
			const hSpan = horizSpan[cell]
			if (hSpan <= 4) {
				const wide = Math.max(hSpan, openU ? horizSpan[cell - W] : hSpan, openD ? horizSpan[cell + W] : hSpan)
				if (wide > hSpan && Math.abs(ty) > 0.02)
					ty *= Math.min(GAS_NOZZLE * 1.4, wide / hSpan)
			}

			let ux = gasUx[cell] + (tx - gasUx[cell]) * GAS_BLEND
			let uy = gasUy[cell] + (ty - gasUy[cell]) * GAS_BLEND

			if (!openL && ux < 0) ux = 0
			if (!openR && ux > 0) ux = 0
			if (!openU && uy < 0) uy = 0
			if (!openD && uy > 0) uy = 0

			let sumUx = ux
			let sumUy = uy
			let count = 1
			if (openL) { sumUx += gasUx[cell - 1]; sumUy += gasUy[cell - 1]; count++ }
			if (openR) { sumUx += gasUx[cell + 1]; sumUy += gasUy[cell + 1]; count++ }
			if (openU) { sumUx += gasUx[cell - W]; sumUy += gasUy[cell - W]; count++ }
			if (openD) { sumUx += gasUx[cell + W]; sumUy += gasUy[cell + W]; count++ }
			ux = ux * 0.65 + (sumUx / count) * 0.35
			uy = uy * 0.65 + (sumUy / count) * 0.35

			// Sealed cavities damp bulk motion unless local drive keeps them alive.
			if (!open && localDrive <= 0.05) {
				ux *= 0.85
				uy *= 0.85
			}

			const outUx = Math.max(-GAS_SPEED_MAX, Math.min(GAS_SPEED_MAX, ux))
			const outUy = Math.max(-GAS_SPEED_MAX, Math.min(GAS_SPEED_MAX, uy))
			nextUx[cell] = outUx
			nextUy[cell] = outUy
			if (outUy < maxUpdraft) maxUpdraft = outUy
		}
	}

	// Swap velocity buffers — avoid O(WH) .set copy.
	world.scratch.gasNextUx = gasUx
	world.scratch.gasNextUy = gasUy
	world.gasUx = nextUx
	world.gasUy = nextUy
	world.maxUpdraft = maxUpdraft
}

/**
 * Total sealed gas amount (for tests).
 * @param {FluidWorld} world fluid world
 * @returns {number} sealed gas mass
 */
export const totalSealedGas = (world) => {
	let gas = 0
	for (let id = 1; id < world.regions.length; id++) {
		const region = world.regions[id]
		if (region && !region.openToAtm) gas += region.gasAmount
	}
	return gas
}
