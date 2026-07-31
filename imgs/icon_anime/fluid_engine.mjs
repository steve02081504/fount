/**
 * Particle / grid-liquid / gas-flow engine for ASCII scenes.
 *
 * Air regions carry conserved gas mass; sealed cavities follow isothermal Boyle:
 *   P / P_atm = gasAmount / airVolume  (ideal gas at fixed T)
 * Open air carries a velocity field driven by a time-varying global wind with
 * height shear and continuity speeding flow through constrictions (wind-tunnel).
 * Bernoulli proxy: static P ≈ region P − ½ρu².
 * Communicating vessels equalize hydraulic potential:
 *   φ = P / (ρg) - surfaceY
 *
 * Rain particles feel local gas drag; fall glyphs lean with velocity
 * (`\` / `/` / `-` / `|` / `,` / `.`).
 *
 * Soil (HORIZON / SOLID) stores moisture; seepage shares sideways, prefers down,
 * and feeds underside condensation that drips into air. All soil transfers conserve mass.
 * SEAL is an impermeable barrier (tests / vessels) — blocks liquid, holds no moisture.
 *
 * POOL retains fill and spills when overfull / leaked by the scene.
 * BODY is an impact shell: particles splash and vanish; free liquid cannot enter.
 * Slopes stay sealed splash faces. Pillar glyphs (`:`) are scene-visual only.
 */

/** @typedef {{
 *   viewW: number, viewH: number, worldW: number, worldH: number,
 *   margin: number, ox: number, oy: number,
 *   mat: Uint8Array, liq: Float32Array, moisture: Float32Array, condense: Float32Array,
 *   gasUx: Float32Array, gasUy: Float32Array,
 *   liqVx: Float32Array, liqVy: Float32Array,
 *   regionId: Int32Array,
 *   regions: Map<number, AirRegion>,
 *   particles: FluidParticle[], pendingSplash: FluidParticle[],
 *   soilStep: number, gasTime: number,
 * }} FluidWorld
 *
 * @typedef {{
 *   id: number,
 *   openToAtm: boolean,
 *   airCells: number,
 *   gasAmount: number,
 *   pressure: number,
 * }} AirRegion
 *
 * @typedef {{ x: number, y: number, vx: number, vy: number, life: number, amt: number }} FluidParticle
 */

/** Material enum. */
export const MAT = {
	AIR: 0,
	SOLID: 1,
	SLOPE_L: 2,
	SLOPE_R: 3,
	HORIZON: 4,
	POOL: 5,
	BODY: 6,
	/** Impermeable barrier — no moisture / seepage (tests & sealed vessels). */
	SEAL: 7,
}

/**
 *
 */
export const P_ATM = 1
/**
 *
 */
export const RHO_G = 1

/** Max moisture a soil cell can hold. */
export const SOIL_CAP = 1
/** Peak free-liquid absorb rate into dry soil, per tick (slow — rain must be able to puddle). */
export const SOIL_ABSORB_RATE = 0.015
/** Absorb rate falls as `(1 - wetness) ** expo` (dry soil drinks fastest). */
export const SOIL_ABSORB_EXPO = 1.8
/** Max fraction of a rain/impact hit absorbed into dry soil; rest sheets as free liquid. */
export const SOIL_HIT_ABSORB_FRAC = 0.3
/** Fraction of moisture shared laterally (split evenly among soil sides). */
export const SOIL_SIDE_FRAC = 0.04
/** Fraction of moisture transferred into soil below (highest). */
export const SOIL_DOWN_FRAC = 0.06
/** Fraction of moisture fed into underside condensation when below is air. */
export const SOIL_CONDENSE_FRAC = 0.06
/** Condensation amount that draws as a hanging droplet. */
export const COND_DRAW = 0.35
/** Condensation amount that drips (clears into free liquid below). */
export const COND_DRIP = 0.85
/** Lateral Matthew transfer rate between neighboring condensation cells. */
export const COND_MATTHEW_RATE = 0.22
/** Noise amplitude (fraction of pair mass) to break condensation ties. */
export const COND_MATTHEW_NOISE = 0.4
/** Falling / stream amount at which vertical glyphs prefer dense bars. */
export const FALL_HEAVY = 0.5
/** Speed below this → still-water glyphs (‥…~⁓–). */
export const STILL_SPEED = 0.06
/** |vx| above this (vs vertical) counts as horizontal/slant motion. */
export const SLANT_SPEED = 0.08
/** |vx| dominates |vy| → flat `-`. */
export const FLAT_RATIO = 1.2
/** Momentum (amount·speed) at/above this uses high-momentum slant glyphs. */
export const HIGH_MOMENTUM = 0.28
/** Absolute speed at/above this also counts as high momentum. */
export const HIGH_SPEED = 0.55

/** High-momentum left / right slant. */
export const WATER_HIGH_L = Object.freeze(['/', '∕'])
/**
 *
 */
export const WATER_HIGH_R = Object.freeze(['\\', '∖'])
/** Low-momentum toward lower-left. */
export const WATER_LOW_DL = Object.freeze(['‚', '´', '′', '‘', '’', '″', '“', '„', '‴', '⁗'])
/** Low-momentum toward lower-right. */
export const WATER_LOW_DR = Object.freeze(['‵', '‛', '‶', '‟', '‷', '⁏'])
/** Pure vertical fall (heavy → light). */
export const WATER_FALL = Object.freeze(['|', '¦', '‖', '⁞', '⁚', '⁝', '.'])
/** Near-still pool (light → heavy). */
export const WATER_STILL = Object.freeze(['‥', '…', '~', '⁓', '–'])

/** Mean global wind amplitude (cells / tick). */
export const WIND_BASE = 0.38
/** Gust amplitude layered on the mean wind. */
export const WIND_GUST = 0.28
/** Boundary-layer shear: u ∝ altitude^power (stronger aloft). */
export const WIND_SHEAR_POWER = 0.55
/** Particle velocity blend toward local gas (horizontal). */
export const GAS_DRAG = 0.22
/** Vertical gas coupling for rain (weaker — gravity dominates). */
export const GAS_DRAG_Y = 0.06
/** Blend of cell gas toward wind / pressure target each tick. */
export const GAS_BLEND = 0.28
/** Continuity boost when horizontal passage is constricted. */
export const GAS_NOZZLE = 1.55

/**
 * @param {number} m parameter
 * @returns {boolean} result
 */
export const isSolidMat = m =>
	m === MAT.SOLID || m === MAT.SLOPE_L || m === MAT.SLOPE_R || m === MAT.HORIZON || m === MAT.SEAL

/**
 * Terrain soil that stores moisture (surface + fill). Slopes / SEAL are non-porous.
 * @param {number} m parameter
 * @returns {boolean} result
 */
export const isSoilMat = m => m === MAT.HORIZON || m === MAT.SOLID

/**
 * @param {number} m parameter
 * @returns {boolean} result
 */
export const isBlockMat = m => isSolidMat(m) || m === MAT.POOL || m === MAT.BODY

/**
 * Materials that free liquid cannot occupy (solids + BODY impact shell).
 * @param {number} m parameter
 * @returns {boolean} result
 */
export const isLiquidBarrier = m => isSolidMat(m) || m === MAT.BODY

/**
 * Dry-soil absorb factor in [0, 1] — full when empty, →0 as moisture fills.
 * @param {number} moisture parameter
 * @returns {number} result
 */
export const soilAbsorbFactor = (moisture) => {
	const wet = Math.min(1, Math.max(0, moisture / SOIL_CAP))
	return (1 - wet) ** SOIL_ABSORB_EXPO
}

/**
 * Deterministic hash in [0, 1).
 * @param {number} a parameter
 * @param {number} [b=0] parameter
 * @returns {number} result
 */
export const hash01 = (a, b = 0) => {
	let n = Math.imul(a ^ Math.imul(b, 1597334677), 3812015801)
	n ^= n >>> 13
	n = Math.imul(n, 1274126177)
	return ((n ^ n >>> 16) >>> 0) / 4294967296
}

const GRAVITY = 0.12
const MAX_VY = 1.15
const LIQ_FULL = 1
const LIQ_DRAW = 0.35
const AIR_CELL = 1 // unit volume per empty air cell

/**
 * @param {{ width: number, height: number, margin?: number, bottomExtra?: number }} [opts] parameter
 * @returns {FluidWorld} result
 */
export const createWorld = ({ width, height, margin = 24, bottomExtra = 4 } = {}) => {
	const viewW = width
	const viewH = height
	const worldW = viewW + margin * 2
	const worldH = viewH + bottomExtra
	const ox = margin
	const size = worldW * worldH
	return {
		viewW, viewH, worldW, worldH, margin, ox, oy: 0,
		mat: new Uint8Array(size),
		liq: new Float32Array(size),
		moisture: new Float32Array(size),
		condense: new Float32Array(size),
		gasUx: new Float32Array(size),
		gasUy: new Float32Array(size),
		liqVx: new Float32Array(size),
		liqVy: new Float32Array(size),
		regionId: new Int32Array(size),
		regions: new Map(),
		particles: /** @type {FluidParticle[]} */ [],
		pendingSplash: /** @type {FluidParticle[]} */ [],
		soilStep: 0,
		gasTime: 0,
		_gasNextUx: null,
		_gasNextUy: null,
		_liqFlowX: null,
		_liqFlowY: null,
	}
}

/**
 * @param {FluidWorld} w parameter
 * @param {number} x parameter
 * @param {number} y parameter
 * @returns {number} result
 */
export const idx = (w, x, y) => y * w.worldW + x

/**
 * @param {FluidWorld} w parameter
 * @param {number} x parameter
 * @param {number} y parameter
 * @returns {boolean} result
 */
export const inWorld = (w, x, y) =>
	x >= 0 && y >= 0 && x < w.worldW && y < w.worldH

/**
 * @param {FluidWorld} w parameter
 * @returns {void} result
 */
export const clearDynamics = (w) => {
	w.liq.fill(0)
	w.moisture.fill(0)
	w.condense.fill(0)
	w.gasUx.fill(0)
	w.gasUy.fill(0)
	w.liqVx.fill(0)
	w.liqVy.fill(0)
	w.particles.length = 0
	w.pendingSplash.length = 0
	w.regionId.fill(0)
	w.regions.clear()
	w.gasTime = 0
}

/**
 * Clear material labels only — moisture/condense persist across rebuilds.
 * @param {FluidWorld} w parameter
 * @returns {void} result
 */
export const clearMaterials = (w) => {
	w.mat.fill(MAT.AIR)
}

/**
 * After materials are rebuilt: dump water from non-soil cells into free liquid (or discard on barriers).
 * @param {FluidWorld} w parameter
 * @returns {void} result
 */
export const releaseNonSoilWater = (w) => {
	const { worldW: W, worldH: H, mat, liq, moisture, condense } = w
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			if (isSoilMat(mat[i])) continue
			const held = moisture[i] + condense[i]
			moisture[i] = 0
			condense[i] = 0
			if (held <= 0) continue
			if (mat[i] === MAT.POOL || mat[i] === MAT.AIR) {
				liq[i] = Math.min(LIQ_FULL, liq[i] + held)
				continue
			}
			if (y > 0 && !isLiquidBarrier(mat[(y - 1) * W + x])) {
				const ai = (y - 1) * W + x
				liq[ai] = Math.min(LIQ_FULL, liq[ai] + held)
			}
			// else: barrier with nowhere to put it — leave the world
		}
}

/**
 * @param {FluidWorld} w parameter
 * @param {number} x parameter
 * @param {number} y parameter
 * @param {number} m parameter
 * @returns {void} result
 */
export const setMat = (w, x, y, m) => {
	if (!inWorld(w, x, y)) return
	w.mat[idx(w, x, y)] = m
}

/**
 * Add moisture into a soil cell (clamped). Returns amount actually stored.
 * @param {FluidWorld} w parameter
 * @param {number} x parameter
 * @param {number} y parameter
 * @param {number} amt parameter
 * @returns {number} result
 */
export const addMoisture = (w, x, y, amt) => {
	if (!inWorld(w, x, y) || amt <= 0) return 0
	const i = idx(w, x, y)
	if (!isSoilMat(w.mat[i])) return 0
	const before = w.moisture[i]
	w.moisture[i] = Math.min(SOIL_CAP, before + amt)
	return w.moisture[i] - before
}

/**
 * Grid water total: free liquid + soil moisture + hanging condensation.
 * @param {FluidWorld} w parameter
 * @returns {number} result
 */
export const totalGridWater = (w) => {
	let t = 0
	for (let i = 0; i < w.liq.length; i++)
		t += w.liq[i] + w.moisture[i] + w.condense[i]
	return t
}

/**
 * @param {FluidWorld} w parameter
 * @param {number} x parameter
 * @param {number} y parameter
 * @param {number} amt parameter
 * @returns {number} result
 */
export const addLiquid = (w, x, y, amt) => {
	if (!inWorld(w, x, y)) return 0
	const i = idx(w, x, y)
	if (isLiquidBarrier(w.mat[i])) return 0
	const before = w.liq[i]
	w.liq[i] = Math.min(LIQ_FULL, before + amt)
	return w.liq[i] - before
}

/**
 * @param {FluidWorld} w parameter
 * @param {number} x parameter
 * @param {number} y parameter
 * @param {number} vx parameter
 * @param {number} vy parameter
 * @param {number} [life=40] parameter
 * @param {number} [amt=0.4] water mass carried by the droplet
 * @returns {void} result
 */
export const spawnParticle = (w, x, y, vx, vy, life = 40, amt = 0.4) => {
	if (w.particles.length > 1200) return
	w.particles.push({ x, y, vx, vy, life, amt })
}

/**
 * @param {FluidWorld} w parameter
 * @param {number} x parameter
 * @param {number} y parameter
 * @param {number} vx parameter
 * @param {number} vy parameter
 * @param {number} [life=18] parameter
 * @param {number} [amt=0.25] water mass carried by the splash
 * @returns {void} result
 */
export const queueSplash = (w, x, y, vx, vy, life = 18, amt = 0.25) => {
	w.pendingSplash.push({ x, y, vx, vy, life, amt })
}

/**
 * Cell is air-like for region flood-fill (not solid/block, liquid below draw).
 * @param {FluidWorld} w parameter
 * @param {number} i parameter
 * @returns {boolean} result
 */
const isAirCell = (w, i) => {
	if (isBlockMat(w.mat[i])) return false
	if (w.liq[i] >= LIQ_DRAW) return false
	return true
}

/**
 * Label air regions with conserved gas mass transfer across topology changes.
 * Open-to-atmosphere regions get P = P_ATM; sealed use Boyle.
 * @param {FluidWorld} w parameter
 * @returns {void} result
 */
export const labelAirRegions = (w) => {
	const { worldW: W, worldH: H, regionId } = w
	const oldId = Int32Array.from(regionId)
	/** @type {Map<number, AirRegion>} */
	const oldRegions = w.regions
	regionId.fill(0)

	/** @type {Map<number, AirRegion>} */
	const nextRegions = new Map()
	let next = 1
	const q = []

	/**
	 * @param {number} x parameter
	 * @param {number} y parameter
	 * @param {number} id parameter
	 * @param {AirRegion} region parameter
	 * @returns {void} result
	 */
	const seed = (x, y, id, region) => {
		if (x < 0 || y < 0 || x >= W || y >= H) return
		const i = y * W + x
		if (regionId[i]) return
		if (!isAirCell(w, i)) return
		regionId[i] = id
		region.airCells++
		q.push(x, y)
	}

	// Pass 1: flood from open boundaries → open atmosphere region(s) merged as id=1 style open
	/** @type {AirRegion} */
	const openRegion = { id: next, openToAtm: true, airCells: 0, gasAmount: 0, pressure: P_ATM }
	const openId = next++
	openRegion.id = openId
	for (let x = 0; x < W; x++) seed(x, 0, openId, openRegion)
	for (let y = 1; y < H; y++) {
		seed(0, y, openId, openRegion)
		seed(W - 1, y, openId, openRegion)
	}
	for (let qi = 0; qi < q.length; qi += 2) {
		const x = q[qi]
		const y = q[qi + 1]
		seed(x - 1, y, openId, openRegion)
		seed(x + 1, y, openId, openRegion)
		seed(x, y - 1, openId, openRegion)
		seed(x, y + 1, openId, openRegion)
	}
	if (openRegion.airCells > 0) {
		openRegion.gasAmount = openRegion.airCells * AIR_CELL * P_ATM
		openRegion.pressure = P_ATM
		nextRegions.set(openId, openRegion)
	}

	// Pass 2: sealed cavities
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			if (regionId[i] || !isAirCell(w, i)) continue
			const id = next++
			/** @type {AirRegion} */
			const region = { id, openToAtm: false, airCells: 0, gasAmount: 0, pressure: P_ATM }
			q.length = 0
			seed(x, y, id, region)
			for (let qi = 0; qi < q.length; qi += 2) {
				const cx = q[qi]
				const cy = q[qi + 1]
				seed(cx - 1, cy, id, region)
				seed(cx + 1, cy, id, region)
				seed(cx, cy - 1, id, region)
				seed(cx, cy + 1, id, region)
			}
			nextRegions.set(id, region)
		}

	// Transfer gas from old regions by overlap
	/** @type {Map<number, Map<number, number>>} oldId → newId → overlap cells */
	const overlap = new Map()
	for (let i = 0; i < oldId.length; i++) {
		const o = oldId[i]
		const n = regionId[i]
		if (!o || !n) continue
		let row = overlap.get(o)
		if (!row) {
			row = new Map()
			overlap.set(o, row)
		}
		row.set(n, (row.get(n) || 0) + 1)
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
			let oldTotalOverlap = 0
			for (const c of row.values()) oldTotalOverlap += c
			const share = cells / Math.max(1, oldTotalOverlap)
			gas += old.gasAmount * share
		}
		if (!got)
			gas = region.airCells * AIR_CELL * P_ATM
		region.gasAmount = gas
		const vol = Math.max(AIR_CELL * 0.25, region.airCells * AIR_CELL)
		region.pressure = Math.max(0.05, Math.min(8, gas / vol))
	}

	w.regions = nextRegions
}

/**
 * Pressure at cell from its air region (liquid cells use overlying air or atm).
 * @param {FluidWorld} w parameter
 * @param {number} x parameter
 * @param {number} y parameter
 * @returns {number} result
 */
export const pressureAt = (w, x, y) => {
	if (!inWorld(w, x, y)) return P_ATM
	const i = idx(w, x, y)
	const rid = w.regionId[i]
	if (rid) {
		const r = w.regions.get(rid)
		return r ? r.pressure : P_ATM
	}
	// look upward for air region above liquid column
	for (let yy = y - 1; yy >= 0; yy--) {
		const ii = idx(w, x, yy)
		if (isBlockMat(w.mat[ii])) break
		const r2 = w.regionId[ii]
		if (r2) {
			const r = w.regions.get(r2)
			return r ? r.pressure : P_ATM
		}
	}
	return P_ATM
}

/**
 * Time-varying global wind scalar (positive → rightward).
 * @param {number} time tick
 * @param {number} [seed=0] scene seed
 * @returns {number} wind
 */
export const globalWindAt = (time, seed = 0) => {
	const phase = hash01(seed, 91) * Math.PI * 2
	return WIND_BASE * Math.sin(time * 0.031 + phase)
		+ WIND_GUST * Math.sin(time * 0.067 + phase * 1.7)
		+ WIND_BASE * 0.18 * Math.sin(time * 0.013 + 1.1)
}

/**
 * Height-sheared wind: stronger aloft (y=0 sky), weaker near ground.
 * Power-law boundary layer: u ∝ altitude^WIND_SHEAR_POWER.
 * @param {number} y world row
 * @param {number} worldH world height
 * @param {number} time tick
 * @param {number} [seed=0] scene seed
 * @returns {number} horizontal wind at height
 */
export const windProfileAt = (y, worldH, time, seed = 0) => {
	const wind = globalWindAt(time, seed)
	const alt = 1 - Math.min(1, Math.max(0, y / Math.max(1, worldH - 1)))
	return wind * (0.28 + 0.72 * alt ** WIND_SHEAR_POWER)
}

/**
 * Sample gas velocity at a world point (nearest cell).
 * @param {FluidWorld} w parameter
 * @param {number} x parameter
 * @param {number} y parameter
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
 * Dynamic pressure proxy ½ρu² (ρ=RHO_G) for Bernoulli checks.
 * @param {number} ux parameter
 * @param {number} [uy=0] parameter
 * @returns {number} result
 */
export const dynamicPressure = (ux, uy = 0) => 0.5 * RHO_G * (ux * ux + uy * uy)

/**
 * Bernoulli static-pressure proxy: P₀ − ½ρu² (clamped).
 * Along a streamline, faster flow → lower static pressure.
 * @param {FluidWorld} w parameter
 * @param {number} x parameter
 * @param {number} y parameter
 * @returns {number} result
 */
export const staticPressureAt = (w, x, y) => {
	const { ux, uy } = gasVelocityAt(w, x, y)
	return Math.max(0.05, pressureAt(w, x, y) - dynamicPressure(ux, uy))
}

/**
 * Advance open-air / cavity gas velocity: wind shear, nozzle continuity, wall slip.
 * @param {FluidWorld} w parameter
 * @param {{ time?: number, seed?: number, forceWind?: number }} [opts]
 *   `forceWind` overrides the global wind scalar (tests / scripted gusts).
 * @returns {void} result
 */
export const stepGas = (w, opts = {}) => {
	const time = opts.time ?? w.gasTime
	const seed = opts.seed ?? 0
	const forced = opts.forceWind
	w.gasTime = time + 1
	labelAirRegions(w)

	const { worldW: W, worldH: H, mat, liq, gasUx, gasUy, regionId, regions } = w
	const n = W * H
	if (!w._gasNextUx || w._gasNextUx.length !== n) {
		w._gasNextUx = new Float32Array(n)
		w._gasNextUy = new Float32Array(n)
	}
	const nextUx = w._gasNextUx
	const nextUy = w._gasNextUy
	nextUx.fill(0)
	nextUy.fill(0)

	/**
	 * @param {number} x parameter
	 * @param {number} y parameter
	 * @returns {boolean} blocked for gas
	 */
	const blocked = (x, y) => {
		if (x < 0 || y < 0 || x >= W || y >= H) return true
		const i = y * W + x
		return isBlockMat(mat[i]) || liq[i] >= LIQ_DRAW
	}

	/**
	 * Vertical free span through (x,y); large ⇒ open sky (skip nozzle).
	 * @param {number} x parameter
	 * @param {number} y parameter
	 * @returns {number} span
	 */
	const vertSpan = (x, y) => {
		let y0 = y
		let y1 = y
		while (y0 > 0 && !blocked(x, y0 - 1)) y0--
		while (y1 + 1 < H && !blocked(x, y1 + 1)) y1++
		return y1 - y0 + 1
	}

	/**
	 * Horizontal free span through (x,y).
	 * @param {number} x parameter
	 * @param {number} y parameter
	 * @returns {number} span
	 */
	const horizSpan = (x, y) => {
		let x0 = x
		let x1 = x
		while (x0 > 0 && !blocked(x0 - 1, y)) x0--
		while (x1 + 1 < W && !blocked(x1 + 1, y)) x1++
		return x1 - x0 + 1
	}

	/**
	 * Height-sheared drive wind at row y.
	 * @param {number} y parameter
	 * @returns {number} ux drive
	 */
	const driveWind = (y) => {
		const alt = 1 - Math.min(1, Math.max(0, y / Math.max(1, H - 1)))
		const shear = 0.28 + 0.72 * alt ** WIND_SHEAR_POWER
		if (forced !== undefined) return forced * shear
		return windProfileAt(y, H, time, seed)
	}

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			if (blocked(x, y)) {
				nextUx[i] = 0
				nextUy[i] = 0
				continue
			}

			const rid = regionId[i]
			const region = rid ? regions.get(rid) : null
			const open = !region || region.openToAtm

			let tx = open ? driveWind(y) : 0
			let ty = 0

			const openL = !blocked(x - 1, y)
			const openR = !blocked(x + 1, y)
			const openU = !blocked(x, y - 1)
			const openD = !blocked(x, y + 1)

			// Continuity (A·v): throat narrower than neighbors → faster (wind-tunnel)
			const span = vertSpan(x, y)
			if (span <= 4) {
				const spanL = openL ? vertSpan(x - 1, y) : span
				const spanR = openR ? vertSpan(x + 1, y) : span
				const wide = Math.max(span, spanL, spanR)
				if (wide > span && Math.abs(tx) > 0.02)
					tx *= Math.min(GAS_NOZZLE * 1.4, wide / span)
			}
			const hSpan = horizSpan(x, y)
			if (hSpan <= 4) {
				const spanU = openU ? horizSpan(x, y - 1) : hSpan
				const spanD = openD ? horizSpan(x, y + 1) : hSpan
				const wide = Math.max(hSpan, spanU, spanD)
				if (wide > hSpan && Math.abs(ty) > 0.02)
					ty *= Math.min(GAS_NOZZLE * 1.4, wide / hSpan)
			}

			let ux = gasUx[i] + (tx - gasUx[i]) * GAS_BLEND
			let uy = gasUy[i] + (ty - gasUy[i]) * GAS_BLEND

			// Wall slip: cancel inflow into solids
			if (!openL && ux < 0) ux = 0
			if (!openR && ux > 0) ux = 0
			if (!openU && uy < 0) uy = 0
			if (!openD && uy > 0) uy = 0

			// Mild viscosity from neighbors (stable ASCII-scale field)
			let sumUx = ux
			let sumUy = uy
			let count = 1
			if (openL) {
				sumUx += gasUx[i - 1]
				sumUy += gasUy[i - 1]
				count++
			}
			if (openR) {
				sumUx += gasUx[i + 1]
				sumUy += gasUy[i + 1]
				count++
			}
			if (openU) {
				sumUx += gasUx[i - W]
				sumUy += gasUy[i - W]
				count++
			}
			if (openD) {
				sumUx += gasUx[i + W]
				sumUy += gasUy[i + W]
				count++
			}
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
 * @param {FluidWorld} w parameter
 * @param {number} x parameter
 * @param {number} y parameter
 * @returns {boolean} result
 */
const canOccupy = (w, x, y) => {
	if (!inWorld(w, x, y)) return false
	const i = idx(w, x, y)
	const m = w.mat[i]
	if (isLiquidBarrier(m)) return false
	if (m === MAT.POOL) return w.liq[i] < LIQ_FULL
	return true
}

/**
 * Label connected liquid components; return free-surface samples.
 * @param {FluidWorld} w parameter
 * @returns {{ surfaces: { x: number, y: number, component: number, pressure: number }[], componentOf: Int32Array }} result
 */
export const labelLiquidSurfaces = (w) => {
	const { worldW: W, worldH: H, mat, liq } = w
	const componentOf = new Int32Array(W * H)
	let next = 1
	const surfaces = []

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			if (componentOf[i] || liq[i] < LIQ_DRAW || isLiquidBarrier(mat[i])) continue
			const id = next++
			const q = [x, y]
			componentOf[i] = id
			/** @type {{ x: number, y: number }[]} */
			const cells = []
			for (let qi = 0; qi < q.length; qi += 2) {
				const cx = q[qi]
				const cy = q[qi + 1]
				cells.push({ x: cx, y: cy })
				for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
					const nx = cx + dx
					const ny = cy + dy
					if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
					const ni = ny * W + nx
					if (componentOf[ni] || liq[ni] < LIQ_DRAW || isLiquidBarrier(mat[ni])) continue
					componentOf[ni] = id
					q.push(nx, ny)
				}
			}
			// free surfaces: liquid with air (or empty) above
			for (const c of cells) {
				const aboveY = c.y - 1
				if (aboveY < 0) {
					surfaces.push({ x: c.x, y: c.y, component: id, pressure: P_ATM })
					continue
				}
				const ai = aboveY * W + c.x
				if (isLiquidBarrier(mat[ai])) continue
				if (liq[ai] >= LIQ_DRAW) continue
				surfaces.push({
					x: c.x, y: c.y, component: id,
					pressure: pressureAt(w, c.x, aboveY),
				})
			}
		}

	return { surfaces, componentOf }
}

/**
 * Equalize hydraulic potential across free surfaces of the same liquid component.
 * φ = pressure/(ρg) - y  (y increases downward, so higher liquid → more negative -y wait)
 * With y growing downward: potential head h = -y + P/(ρg); higher fluid (smaller y) has larger -y contribution... 
 * Actually: hydrostatic P = P_gas + ρg * depth. Equilibrium when P_gas/(ρg) + surfaceY equal
 * (surfaceY downward). Flow from high φ to low φ where φ = surfaceY + P_gas/(ρg)? 
 * Standard communicating vessels: lower surface (larger y) means lower water level.
 * Water flows toward the lower surface. Equilibrium: surfaceY + P/(ρg) equal? 
 * If left sealed high P, left surface is pushed down (larger y). So φ = y + P/(ρg) — no.
 * Boyle sealed: gas pressure high → pushes liquid out → surface drops (y increases) until
 * P_gas/(ρg) - y balances. Use φ = P/(ρg) - y; flow from high φ to low φ
 * (high pressure / high elevated surface → toward low).
 * @param {FluidWorld} w parameter
 * @returns {void} result
 */
const equalizeHydraulic = (w) => {
	const { surfaces } = labelLiquidSurfaces(w)
	/** @type {Map<number, typeof surfaces>} */
	const byComp = new Map()
	for (const s of surfaces) {
		let list = byComp.get(s.component)
		if (!list) {
			list = []
			byComp.set(s.component, list)
		}
		list.push(s)
	}

	for (const list of byComp.values()) {
		if (list.length < 2) continue
		// compute mean potential
		let sum = 0
		for (const s of list)
			sum += s.pressure / RHO_G - s.y
		const mean = sum / list.length

		for (const s of list) {
			const phi = s.pressure / RHO_G - s.y
			const delta = phi - mean
			if (Math.abs(delta) < 0.35) continue
			const i = idx(w, s.x, s.y)
			if (delta > 0) {
				// too high — push liquid downward into column / sideways neighbor with lower φ
				const move = Math.min(0.12, w.liq[i] * 0.35, Math.abs(delta) * 0.08)
				if (move < 0.01) continue
				// find a surface in same component with lower φ
				let best = null
				let bestPhi = Infinity
				for (const t of list) {
					if (t === s) continue
					const tp = t.pressure / RHO_G - t.y
					if (tp < bestPhi) {
						bestPhi = tp
						best = t
					}
				}
				if (!best || bestPhi >= phi - 0.2) continue
				const di = idx(w, best.x, best.y)
				const room = LIQ_FULL - w.liq[di]
				const m = Math.min(move, room, w.liq[i])
				if (m <= 0) continue
				w.liq[i] -= m
				w.liq[di] += m
			}
		}
	}
}

/**
 * Soil seepage: absorb free liquid, share moisture, feed condensation, Matthew drip bias, drip.
 * Transfers are closed (source -= amt; sink += amt). World edges may sink mass.
 * @param {FluidWorld} w parameter
 * @returns {void} result
 */
export const stepSoil = (w) => {
	const { worldW: W, worldH: H, mat, liq, moisture, condense } = w
	const n = W * H
	w.soilStep = (w.soilStep + 1) | 0
	const step = w.soilStep

	// Absorb free liquid from the air cell above — dry soil drinks fastest.
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			if (!isSoilMat(mat[i]) || y === 0) continue
			const ai = (y - 1) * W + x
			if (isLiquidBarrier(mat[ai]) || liq[ai] <= 0) continue
			const room = SOIL_CAP - moisture[i]
			if (room <= 0) continue
			const rate = SOIL_ABSORB_RATE * soilAbsorbFactor(moisture[i])
			if (rate <= 1e-8) continue
			const take = Math.min(liq[ai], room, rate)
			liq[ai] -= take
			moisture[i] += take
		}

	/** @type {{ from: number, to: number, amt: number }[]} */
	const moves = []
	/** @type {{ from: number, amt: number }[]} */
	const feeds = []

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			if (!isSoilMat(mat[i])) continue
			const m = moisture[i]
			if (m <= 1e-8) continue

			if (y + 1 < H) {
				const bi = (y + 1) * W + x
				if (isSoilMat(mat[bi])) {
					const room = Math.max(0, SOIL_CAP - moisture[bi])
					const take = Math.min(m * SOIL_DOWN_FRAC, room)
					if (take > 1e-8) moves.push({ from: i, to: bi, amt: take })
				}
				else if (mat[bi] === MAT.AIR) {
					const take = m * SOIL_CONDENSE_FRAC
					if (take > 1e-8) feeds.push({ from: i, amt: take })
				}
			}
			else {
				const take = m * SOIL_CONDENSE_FRAC
				if (take > 1e-8) feeds.push({ from: i, amt: take })
			}

			const sides = []
			if (x > 0 && isSoilMat(mat[y * W + (x - 1)])) sides.push(y * W + (x - 1))
			if (x + 1 < W && isSoilMat(mat[y * W + (x + 1)])) sides.push(y * W + (x + 1))
			if (sides.length) {
				const each = (m * SOIL_SIDE_FRAC) / sides.length
				for (const si of sides) {
					const room = Math.max(0, SOIL_CAP - moisture[si])
					const take = Math.min(each, room)
					if (take > 1e-8) moves.push({ from: i, to: si, amt: take })
				}
			}
		}

	const outSum = new Float32Array(n)
	for (const mv of moves) outSum[mv.from] += mv.amt
	for (const f of feeds) outSum[f.from] += f.amt
	for (const mv of moves) {
		const cap = moisture[mv.from]
		if (outSum[mv.from] > cap) mv.amt *= cap / outSum[mv.from]
	}
	for (const f of feeds) {
		const cap = moisture[f.from]
		if (outSum[f.from] > cap) f.amt *= cap / outSum[f.from]
	}

	// Capacity at targets: scale all incoming if a cell would overfill.
	const inSum = new Float32Array(n)
	for (const mv of moves) inSum[mv.to] += mv.amt
	for (const mv of moves) {
		const room = Math.max(0, SOIL_CAP - moisture[mv.to])
		if (inSum[mv.to] > room && inSum[mv.to] > 1e-12)
			mv.amt *= room / inSum[mv.to]
	}

	const delta = new Float32Array(n)
	for (const mv of moves) {
		delta[mv.from] -= mv.amt
		delta[mv.to] += mv.amt
	}
	for (const f of feeds) {
		delta[f.from] -= f.amt
		const y = f.from / W | 0
		if (y + 1 >= H) continue // intentional floor sink
		const bi = f.from + W
		if (mat[bi] === MAT.AIR) condense[f.from] += f.amt
		else delta[f.from] += f.amt // topology changed — keep mass in soil
	}
	for (let i = 0; i < n; i++) {
		if (!delta[i]) continue
		moisture[i] += delta[i]
		if (moisture[i] < 0) moisture[i] = 0
		else if (moisture[i] > SOIL_CAP) moisture[i] = SOIL_CAP
	}

	// Matthew condensation: richer neighbors steal from poorer, with noise to break ties.
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W - 1; x++) {
			const i = y * W + x
			const j = i + 1
			if (!isSoilMat(mat[i]) || !isSoilMat(mat[j])) continue
			const ca = condense[i]
			const cb = condense[j]
			if (ca < 1e-8 || cb < 1e-8) continue
			const mass = ca + cb
			const noise = (hash01(i + step * 17, j + step * 31) - 0.5) * COND_MATTHEW_NOISE * mass
			const bias = (ca - cb) + noise
			if (Math.abs(bias) < 1e-8) continue
			const rich = bias > 0 ? i : j
			const poor = bias > 0 ? j : i
			const take = Math.min(
				condense[poor] * COND_MATTHEW_RATE,
				Math.abs(bias) * COND_MATTHEW_RATE,
			)
			if (take <= 1e-8) continue
			condense[poor] -= take
			condense[rich] += take
		}

	// Drip: condensation past threshold becomes free liquid in the air cell below.
	for (let y = 0; y < H - 1; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			if (!isSoilMat(mat[i]) || condense[i] < COND_DRIP) continue
			const bi = (y + 1) * W + x
			if (mat[bi] !== MAT.AIR) continue
			const amt = condense[i]
			const added = addLiquid(w, x, y + 1, amt)
			condense[i] = amt - added
		}
}

/**
 * Liquid step: gravity, side flow (pressure-gated), soil seepage, hydraulic equalization.
 * Tracks per-cell liquid velocity (`liqVx`/`liqVy`) from mass transfers for glyphs.
 * @param {FluidWorld} w parameter
 * @returns {void} result
 */
export const stepLiquid = (w) => {
	const { worldW: W, worldH: H, mat, liq, liqVx, liqVy } = w
	labelAirRegions(w)

	const n = W * H
	if (!w._liqFlowX || w._liqFlowX.length !== n) {
		w._liqFlowX = new Float32Array(n)
		w._liqFlowY = new Float32Array(n)
	}
	const flowX = w._liqFlowX
	const flowY = w._liqFlowY
	flowX.fill(0)
	flowY.fill(0)

	/**
	 * Record mass `move` traveling (dx, dy) from cell i into ni.
	 * @param {number} i source index
	 * @param {number} ni dest index
	 * @param {number} dx horizontal step
	 * @param {number} dy vertical step
	 * @param {number} move mass
	 * @returns {void}
	 */
	const noteFlow = (i, ni, dx, dy, move) => {
		if (move <= 0) return
		flowX[i] += dx * move
		flowY[i] += dy * move
		flowX[ni] += dx * move
		flowY[ni] += dy * move
	}

	// Gravity
	for (let y = H - 2; y >= 0; y--)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			if (liq[i] <= 0) continue
			if (isLiquidBarrier(mat[i])) {
				liq[i] = 0
				continue
			}
			const below = (y + 1) * W + x
			if (!isLiquidBarrier(mat[below]) && liq[below] < LIQ_FULL) {
				// POOL retains fill; only spill into open air when overfull.
				// Drain freely into another POOL cell.
				const retain = mat[i] === MAT.POOL
				const intoPool = mat[below] === MAT.POOL
				if (retain && !intoPool && liq[i] < 0.92) {
					/* keep */
				}
				else {
					// sealed cavity below with high pressure resists inflow
					const pBelow = pressureAt(w, x, y + 1)
					const resist = Math.max(0, (pBelow - P_ATM) * 0.35)
					const capacity = Math.max(0, LIQ_FULL - liq[below] - resist)
					const move = Math.min(liq[i], capacity)
					liq[i] -= move
					liq[below] += move
					noteFlow(i, below, 0, 1, move)
					continue
				}
			}
			const dir = (x + y) & 1 ? 1 : -1
			for (const dx of [dir, -dir]) {
				const nx = x + dx
				const ny = y + 1
				if (!canOccupy(w, nx, ny)) continue
				const ni = ny * W + nx
				if (liq[ni] >= liq[i]) continue
				const retain = mat[i] === MAT.POOL
				const intoPool = mat[ni] === MAT.POOL
				if (retain && !intoPool && liq[i] < 0.92) continue
				const move = Math.min(liq[i] * 0.5, (liq[i] - liq[ni]) * 0.5, LIQ_FULL - liq[ni])
				if (move <= 0.01) continue
				liq[i] -= move
				liq[ni] += move
				noteFlow(i, ni, dx, 1, move)
				break
			}
		}

	// Horizontal spread — allow into sealed dry cells only if pressure permits (compression)
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			if (liq[i] <= 0.05) continue
			if (isLiquidBarrier(mat[i])) continue
			for (const dx of [-1, 1]) {
				const nx = x + dx
				if (nx < 0 || nx >= W) {
					// Intentional world-edge sink: outflow amount leaves the grid.
					const move = Math.min(liq[i] * 0.25, liq[i])
					liq[i] -= move
					flowX[i] += dx * move
					continue
				}
				const ni = y * W + nx
				if (isLiquidBarrier(mat[ni])) continue
				// Retain POOL fill — only spill into open air when overfull
				if (mat[i] === MAT.POOL && mat[ni] === MAT.AIR && liq[i] < 0.92)
					continue
				const targetDrySealed = liq[ni] <= 0.05 && w.regionId[ni] && !w.regions.get(w.regionId[ni])?.openToAtm
				if (targetDrySealed) {
					const r = w.regions.get(w.regionId[ni])
					if (r && r.pressure > P_ATM * 1.15) continue // compressed — resist
				}
				if (liq[ni] >= liq[i] - 0.02) continue
				const move = Math.min((liq[i] - liq[ni]) * 0.25, LIQ_FULL - liq[ni])
				liq[i] -= move
				liq[ni] += move
				noteFlow(i, ni, dx, 0, move)
			}
		}

	stepSoil(w)
	equalizeHydraulic(w)

	// Recompute pressures after liquid moved (volumes changed)
	labelAirRegions(w)

	for (let x = 0; x < W; x++)
		liq[(H - 1) * W + x] = 0

	// Mass-weighted flow → cell velocity (EMA for stable glyphs)
	for (let i = 0; i < n; i++) {
		const m = liq[i]
		if (m < 1e-6) {
			liqVx[i] = 0
			liqVy[i] = 0
			continue
		}
		const vx = flowX[i] / m
		const vy = flowY[i] / m
		liqVx[i] = liqVx[i] * 0.35 + vx * 0.65
		liqVy[i] = liqVy[i] * 0.35 + vy * 0.65
	}
}

/**
 * @param {FluidWorld} w parameter
 * @param {(w: FluidWorld, x: number, y: number, m: number, p: FluidParticle, wet: boolean) => void} onHit parameter
 * @returns {void} result
 */
export const stepParticles = (w, onHit) => {
	const next = []
	for (const p of w.pendingSplash)
		if (w.particles.length + next.length < 1200)
			next.push(p)

	w.pendingSplash.length = 0

	for (const p of w.particles) {
		const { ux, uy } = gasVelocityAt(w, p.x, p.y)
		p.vx += (ux - p.vx) * GAS_DRAG
		p.vy += (uy - p.vy) * GAS_DRAG_Y
		p.vy = Math.min(MAX_VY, p.vy + GRAVITY)
		p.life--
		if (p.life <= 0) continue

		const nx = p.x + p.vx
		const ny = p.y + p.vy

		if (nx < 0 || nx >= w.worldW || ny >= w.worldH) continue
		if (ny < 0) {
			p.x = nx
			p.y = ny
			next.push(p)
			continue
		}

		const cx = nx | 0
		const cy = ny | 0
		if (!inWorld(w, cx, cy)) continue

		const i = idx(w, cx, cy)
		const m = w.mat[i]
		const wet = w.liq[i] >= LIQ_DRAW

		if (m === MAT.AIR && !wet) {
			p.x = nx
			p.y = ny
			next.push(p)
			continue
		}

		onHit(w, cx, cy, m, p, wet)
	}

	w.particles = next
}

/**
 * Pick a glyph from a set by amount (+ phase wobble).
 * @param {readonly string[]} chars glyph set
 * @param {number} amount water mass in [0, 1+]
 * @param {number} phase flicker seed
 * @param {boolean} [heavyFirst=false] if true, larger amount → earlier chars
 * @returns {string} glyph
 */
export const pickWaterGlyph = (chars, amount, phase, heavyFirst = false) => {
	const n = chars.length
	const u = Math.min(0.999, Math.max(0, amount))
	const t = heavyFirst ? 1 - u : u
	let i = (t * n) | 0
	if ((phase | 0) & 1) i = Math.min(n - 1, i + 1)
	return chars[i]
}

/**
 * Water glyph from amount + liquid/particle velocity (not gas wind).
 * High momentum slant: `/` `∕` · `\` `∖` · `-`
 * Low momentum diagonal: low quotes / reversed primes · `-`
 * Pure fall: `|¦‖⁞⁚⁝.`
 * Still: `‥…~⁓–`
 * @param {number} amount parameter
 * @param {number} [phase=0] parameter
 * @param {number} [vx=0] liquid / droplet horizontal velocity
 * @param {number} [vy=0] liquid / droplet vertical velocity (down +)
 * @returns {string} result
 */
export const waterChar = (amount, phase = 0, vx = 0, vy = 0) => {
	const ax = Math.abs(vx)
	const ay = Math.abs(vy)
	const speed = Math.hypot(vx, vy)
	const mom = amount * speed

	if (speed < STILL_SPEED)
		return pickWaterGlyph(WATER_STILL, amount, phase, false)

	const flat = ax >= SLANT_SPEED && ax > ay * FLAT_RATIO
	if (flat) return '-'

	const slant = ax >= SLANT_SPEED
	const high = mom >= HIGH_MOMENTUM || speed >= HIGH_SPEED

	if (slant) {
		if (high)
			return pickWaterGlyph(vx > 0 ? WATER_HIGH_R : WATER_HIGH_L, amount, phase, true)
		// Low momentum: prefer lower-left / lower-right marks
		return pickWaterGlyph(vx > 0 ? WATER_LOW_DR : WATER_LOW_DL, amount, phase, true)
	}

	// Pure vertical: remap so amount ≥ FALL_HEAVY lands on dense bars
	const fallAmt = amount >= FALL_HEAVY ? 1 : amount / FALL_HEAVY * 0.4
	return pickWaterGlyph(WATER_FALL, fallAmt, phase, true)
}

/**
 * Falling / stream glyph — same as waterChar (amount + droplet velocity).
 * @param {number} amount parameter
 * @param {number} [phase=0] parameter
 * @param {number} [vx=0] parameter
 * @param {number} [vy=0] parameter
 * @returns {string} result
 */
export const fallChar = waterChar

/** Alias — rain uses the same amount/velocity glyphs. */
export const rainChar = waterChar

/**
 * Free-liquid glyph: uses liquid velocity; optional `falling` biases a calm cell downward.
 * @param {number} amount parameter
 * @param {number} phase parameter
 * @param {boolean} [falling=false] parameter
 * @param {number} [vx=0] parameter
 * @param {number} [vy=0] parameter
 * @returns {string} result
 */
export const liquidChar = (amount, phase, falling = false, vx = 0, vy = 0) => {
	if (falling && Math.hypot(vx, vy) < STILL_SPEED)
		vy = 0.55
	return waterChar(amount, phase, vx, vy)
}

/**
 * Hanging droplet under a soil ceiling, by condensation amount.
 * @param {number} amount parameter
 * @param {number} phase parameter
 * @returns {string} result
 */
export const dripChar = (amount, phase) => {
	if (amount >= COND_DRIP) return 'o'
	if (amount >= 0.6) return phase & 1 ? 'o' : '*'
	if (amount >= COND_DRAW) return phase & 1 ? ',' : '.'
	return ' '
}

/** Draw threshold for free liquid. */
export const LIQUID_DRAW_THRESHOLD = LIQ_DRAW

/** Condensation draw threshold (re-export for composers). */
export const COND_DRAW_THRESHOLD = COND_DRAW

/** Backward-compatible alias. */
export const markAtmosphere = labelAirRegions

/**
 * Total sealed gas amount (for tests).
 * @param {FluidWorld} w parameter
 * @returns {number} result
 */
export const totalSealedGas = (w) => {
	let g = 0
	for (const r of w.regions.values())
		if (!r.openToAtm) g += r.gasAmount
	return g
}
