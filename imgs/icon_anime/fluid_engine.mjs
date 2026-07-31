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

/** Material classification bits — one LUT lookup instead of multi-branch compares. */
const MF_SOLID = 1
const MF_SOIL = 2
const MF_BLOCK = 4
const MF_LIQ_BARRIER = 8
const MAT_FLAGS = new Uint8Array([
	0, // AIR
	MF_SOLID | MF_SOIL | MF_BLOCK | MF_LIQ_BARRIER, // SOLID
	MF_SOLID | MF_BLOCK | MF_LIQ_BARRIER, // SLOPE_L
	MF_SOLID | MF_BLOCK | MF_LIQ_BARRIER, // SLOPE_R
	MF_SOLID | MF_SOIL | MF_BLOCK | MF_LIQ_BARRIER, // HORIZON
	MF_BLOCK, // POOL
	MF_BLOCK | MF_LIQ_BARRIER, // BODY
	MF_SOLID | MF_BLOCK | MF_LIQ_BARRIER, // SEAL
])

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
/** Gust / turbulence amplitude on top of the drifting mean. */
export const WIND_GUST = 0.28
/** Boundary-layer shear: u ∝ altitude^power (stronger aloft). */
export const WIND_SHEAR_POWER = 0.55
/** Ticks per intermittent gust window. */
const WIND_GUST_PERIOD = 41
/** Particle velocity blend toward local gas (horizontal). */
export const GAS_DRAG = 0.22
/** Vertical gas coupling for rain (weaker — gravity dominates). */
export const GAS_DRAG_Y = 0.06
/** Blend of cell gas toward wind / pressure target each tick. */
export const GAS_BLEND = 0.28
/** Continuity boost when horizontal passage is constricted. */
export const GAS_NOZZLE = 1.55

/**
 * @param {number} m material id
 * @returns {boolean} solid-like mat
 */
export const isSolidMat = m => !!(MAT_FLAGS[m] & MF_SOLID)

/**
 * Terrain soil that stores moisture. Slopes / SEAL are non-porous.
 * @param {number} m material id
 * @returns {boolean} soil mat
 */
export const isSoilMat = m => !!(MAT_FLAGS[m] & MF_SOIL)

/**
 * @param {number} m material id
 * @returns {boolean} blocks gas / flood-fill
 */
export const isBlockMat = m => !!(MAT_FLAGS[m] & MF_BLOCK)

/**
 * Solids + BODY impact shell — free liquid cannot occupy.
 * @param {number} m material id
 * @returns {boolean} liquid barrier
 */
export const isLiquidBarrier = m => !!(MAT_FLAGS[m] & MF_LIQ_BARRIER)

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
		_regionIdPrev: null,
		_gasNextUx: null,
		_gasNextUy: null,
		_gasBlocked: null,
		_gasVertSpan: null,
		_gasHorizSpan: null,
		_liqFlowX: null,
		_liqFlowY: null,
		_soilOut: null,
		_soilIn: null,
		_soilDelta: null,
		_mvFrom: null,
		_mvTo: null,
		_mvAmt: null,
		_feedFrom: null,
		_feedAmt: null,
		_floodQ: null,
	}
}

/**
 * Ensure a typed scratch buffer of length `n` on `w[key]`.
 * @param {FluidWorld} w world
 * @param {string} key property name
 * @param {number} n length
 * @param {typeof Float32Array | typeof Uint8Array | typeof Uint16Array | typeof Int32Array} Ctor typed array ctor
 * @returns {Float32Array | Uint8Array | Uint16Array | Int32Array} buffer
 */
const scratch = (w, key, n, Ctor) => {
	let buf = w[key]
	if (!buf || buf.length !== n) {
		buf = new Ctor(n)
		w[key] = buf
	}
	return buf
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
 * Double-buffers `regionId` to avoid copying the previous frame.
 * @param {FluidWorld} w parameter
 * @returns {void} result
 */
export const labelAirRegions = (w) => {
	const { worldW: W, worldH: H } = w
	const n = W * H
	const oldId = w.regionId
	const regionId = /** @type {Int32Array} */ scratch(w, '_regionIdPrev', n, Int32Array)
	regionId.fill(0)

	/** @type {Map<number, AirRegion>} */
	const oldRegions = w.regions
	/** @type {Map<number, AirRegion>} */
	const nextRegions = new Map()
	let next = 1
	const q = /** @type {number[]} */ w._floodQ ??= []
	q.length = 0

	/**
	 * @param {number} x parameter
	 * @param {number} y parameter
	 * @param {number} id parameter
	 * @param {AirRegion} region parameter
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
	/** @type {AirRegion} */
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
			/** @type {AirRegion} */
			const region = { id, openToAtm: false, airCells: 0, gasAmount: 0, pressure: P_ATM }
			q.length = 0
			seed(x, y, id, region)
			flood(id, region)
			nextRegions.set(id, region)
		}

	// Transfer sealed gas by cell-overlap share of each old region.
	/** @type {Map<number, Map<number, number>>} */
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
		const vol = Math.max(AIR_CELL * 0.25, region.airCells * AIR_CELL)
		region.pressure = Math.max(0.05, Math.min(8, gas / vol))
	}

	w._regionIdPrev = oldId
	w.regionId = regionId
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
 * Smooth 1D value noise in [-1, 1] (quintic Hermite; deterministic from seed).
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
 * Pink-ish 1D fBm in ~[-1, 1] — more energy at low frequencies, like real wind spectra.
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
 * Synoptic drift + mesoscale + micro turbulence (fBm), plus intermittent asymmetric gusts —
 * autocorrelated and irregular, not a sine stack.
 * @param {number} time tick
 * @param {number} [seed=0] scene seed
 * @returns {number} wind
 */
export const globalWindAt = (time, seed = 0) => {
	const t0 = hash01(seed, 91) * 100
	// Synoptic: slow signed mean (minutes-scale drift in real winds)
	const synoptic = fbm1d(time * 0.006 + t0, seed + 11, 3)
	// Mesoscale variability
	const meso = fbm1d(time * 0.022 + t0 * 1.3, seed + 29, 4)
	// High-frequency turbulence (weaker)
	const micro = fbm1d(time * 0.07 + t0 * 0.7, seed + 47, 5)
	const base = WIND_BASE * (0.55 * synoptic + 0.3 * meso + 0.15 * micro) * 1.65

	// Intermittent gusts: quick rise, slower decay, usually aligned with the mean
	const gw = Math.floor(time / WIND_GUST_PERIOD)
	const gHash = hash01(seed + 71, gw)
	let gust = 0
	if (gHash > 0.68) {
		const phase = ((time % WIND_GUST_PERIOD) + WIND_GUST_PERIOD) % WIND_GUST_PERIOD / WIND_GUST_PERIOD
		const rise = 0.22
		const env = phase < rise
			? phase / rise
			: Math.max(0, 1 - (phase - rise) / (1 - rise))
		const gDir = base >= 0 ? 1 : -1
		gust = gDir * (gHash - 0.68) / 0.32 * WIND_GUST * 1.55 * env * env
	}
	return base + gust
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
 * Fill free-span lengths along columns (vert) or rows (horiz) in O(WH).
 * Blocked cells get 0; open runs get the run length on every cell in the run.
 * @param {Uint8Array} blocked 1 = blocked
 * @param {number} W width
 * @param {number} H height
 * @param {Uint16Array} outVert vertical free span
 * @param {Uint16Array} outHoriz horizontal free span
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
 * @param {FluidWorld} w parameter
 * @param {{ time?: number, seed?: number, forceWind?: number }} [opts]
 *   \orceWind\ overrides the global wind scalar (tests / scripted gusts).
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
	const nextUx = /** @type {Float32Array} */ scratch(w, '_gasNextUx', n, Float32Array)
	const nextUy = /** @type {Float32Array} */ scratch(w, '_gasNextUy', n, Float32Array)
	const blocked = /** @type {Uint8Array} */ scratch(w, '_gasBlocked', n, Uint8Array)
	const vertSpan = /** @type {Uint16Array} */ scratch(w, '_gasVertSpan', n, Uint16Array)
	const horizSpan = /** @type {Uint16Array} */ scratch(w, '_gasHorizSpan', n, Uint16Array)
	nextUx.fill(0)
	nextUy.fill(0)

	for (let i = 0; i < n; i++)
		blocked[i] = isBlockMat(mat[i]) || liq[i] >= LIQ_DRAW ? 1 : 0
	fillGasSpans(blocked, W, H, vertSpan, horizSpan)

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
			if (blocked[i]) continue

			const rid = regionId[i]
			const region = rid ? regions.get(rid) : null
			const open = !region || region.openToAtm

			let tx = open ? driveWind(y) : 0
			let ty = 0

			const openL = x > 0 && !blocked[i - 1]
			const openR = x + 1 < W && !blocked[i + 1]
			const openU = y > 0 && !blocked[i - W]
			const openD = y + 1 < H && !blocked[i + W]

			const span = vertSpan[i]
			if (span <= 4) {
				const spanL = openL ? vertSpan[i - 1] : span
				const spanR = openR ? vertSpan[i + 1] : span
				const wide = Math.max(span, spanL, spanR)
				if (wide > span && Math.abs(tx) > 0.02)
					tx *= Math.min(GAS_NOZZLE * 1.4, wide / span)
			}
			const hSpan = horizSpan[i]
			if (hSpan <= 4) {
				const spanU = openU ? horizSpan[i - W] : hSpan
				const spanD = openD ? horizSpan[i + W] : hSpan
				const wide = Math.max(hSpan, spanU, spanD)
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
	const n = W * H
	const componentOf = /** @type {Int32Array} */ scratch(w, '_liqComp', n, Int32Array)
	componentOf.fill(0)
	let next = 1
	/** @type {{ x: number, y: number, component: number, pressure: number }[]} */
	const surfaces = []
	const q = /** @type {number[]} */ w._floodQ ??= []

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			if (componentOf[i] || liq[i] < LIQ_DRAW || isLiquidBarrier(mat[i])) continue
			const id = next++
			q.length = 0
			q.push(x, y)
			componentOf[i] = id
			for (let qi = 0; qi < q.length; qi += 2) {
				const cx = q[qi]
				const cy = q[qi + 1]
				const aboveY = cy - 1
				if (aboveY < 0)
					surfaces.push({ x: cx, y: cy, component: id, pressure: P_ATM })
				else {
					const ai = aboveY * W + cx
					if (!isLiquidBarrier(mat[ai]) && liq[ai] < LIQ_DRAW)
						surfaces.push({
							x: cx, y: cy, component: id,
							pressure: pressureAt(w, cx, aboveY),
						})
				}
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
		}

	return { surfaces, componentOf }
}

/**
 * Equalize hydraulic potential across free surfaces of the same liquid component.
 * φ = P/(ρg) - y; flow from high φ to low φ (communicating vessels / Boyle push).
 * @param {FluidWorld} w parameter
 * @returns {void} result
 */
const equalizeHydraulic = (w) => {
	const { surfaces } = labelLiquidSurfaces(w)
	/** @type {Map<number, typeof surfaces>} */
	const byComp = new Map()
	for (const s of surfaces) {
		let list = byComp.get(s.component)
		if (!list) byComp.set(s.component, list = [])
		list.push(s)
	}

	for (const list of byComp.values()) {
		if (list.length < 2) continue
		let sum = 0
		for (const s of list) sum += s.pressure / RHO_G - s.y
		const mean = sum / list.length

		let best = list[0]
		let bestPhi = best.pressure / RHO_G - best.y
		for (let i = 1; i < list.length; i++) {
			const tp = list[i].pressure / RHO_G - list[i].y
			if (tp < bestPhi) {
				bestPhi = tp
				best = list[i]
			}
		}

		for (const s of list) {
			if (s === best) continue
			const phi = s.pressure / RHO_G - s.y
			const delta = phi - mean
			if (delta <= 0.35) continue
			const i = idx(w, s.x, s.y)
			const move = Math.min(0.12, w.liq[i] * 0.35, Math.abs(delta) * 0.08)
			if (move < 0.01 || bestPhi >= phi - 0.2) continue
			const di = idx(w, best.x, best.y)
			const m = Math.min(move, LIQ_FULL - w.liq[di], w.liq[i])
			if (m <= 0) continue
			w.liq[i] -= m
			w.liq[di] += m
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

	/**
	 * Grow a typed scratch array to at least 
eed elements.
	 * @param {string} key property
	 * @param {number} need length
	 * @param {typeof Int32Array | typeof Float32Array} Ctor ctor
	 * @returns {Int32Array | Float32Array} buffer
	 */
	const grow = (key, need, Ctor) => {
		const buf = w[key]
		if (!buf || buf.length < need) {
			const next = new Ctor(Math.max(need, buf ? buf.length * 2 : 256))
			if (buf) next.set(buf)
			w[key] = next
			return next
		}
		return buf
	}

	let mvFrom = /** @type {Int32Array} */ grow('_mvFrom', 256, Int32Array)
	let mvTo = /** @type {Int32Array} */ grow('_mvTo', 256, Int32Array)
	let mvAmt = /** @type {Float32Array} */ grow('_mvAmt', 256, Float32Array)
	let feedFrom = /** @type {Int32Array} */ grow('_feedFrom', 64, Int32Array)
	let feedAmt = /** @type {Float32Array} */ grow('_feedAmt', 64, Float32Array)
	let mvN = 0
	let feedN = 0

	/**
	 * @param {number} from source
	 * @param {number} to dest
	 * @param {number} amt mass
	 */
	const pushMv = (from, to, amt) => {
		if (mvN >= mvFrom.length) {
			mvFrom = /** @type {Int32Array} */ grow('_mvFrom', mvN + 1, Int32Array)
			mvTo = /** @type {Int32Array} */ grow('_mvTo', mvN + 1, Int32Array)
			mvAmt = /** @type {Float32Array} */ grow('_mvAmt', mvN + 1, Float32Array)
		}
		mvFrom[mvN] = from
		mvTo[mvN] = to
		mvAmt[mvN++] = amt
	}
	/**
	 * @param {number} from source
	 * @param {number} amt mass
	 */
	const pushFeed = (from, amt) => {
		if (feedN >= feedFrom.length) {
			feedFrom = /** @type {Int32Array} */ grow('_feedFrom', feedN + 1, Int32Array)
			feedAmt = /** @type {Float32Array} */ grow('_feedAmt', feedN + 1, Float32Array)
		}
		feedFrom[feedN] = from
		feedAmt[feedN++] = amt
	}

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			if (!isSoilMat(mat[i])) continue
			const m = moisture[i]
			if (m <= 1e-8) continue

			if (y + 1 < H) {
				const bi = (y + 1) * W + x
				if (isSoilMat(mat[bi])) {
					const take = Math.min(m * SOIL_DOWN_FRAC, Math.max(0, SOIL_CAP - moisture[bi]))
					if (take > 1e-8) pushMv(i, bi, take)
				}
				else if (mat[bi] === MAT.AIR) {
					const take = m * SOIL_CONDENSE_FRAC
					if (take > 1e-8) pushFeed(i, take)
				}
			}
			else {
				const take = m * SOIL_CONDENSE_FRAC
				if (take > 1e-8) pushFeed(i, take)
			}

			const left = x > 0 && isSoilMat(mat[i - 1]) ? i - 1 : -1
			const right = x + 1 < W && isSoilMat(mat[i + 1]) ? i + 1 : -1
			const sideN = (left >= 0 ? 1 : 0) + (right >= 0 ? 1 : 0)
			if (sideN) {
				const each = (m * SOIL_SIDE_FRAC) / sideN
				if (left >= 0) {
					const take = Math.min(each, Math.max(0, SOIL_CAP - moisture[left]))
					if (take > 1e-8) pushMv(i, left, take)
				}
				if (right >= 0) {
					const take = Math.min(each, Math.max(0, SOIL_CAP - moisture[right]))
					if (take > 1e-8) pushMv(i, right, take)
				}
			}
		}

	const outSum = /** @type {Float32Array} */ scratch(w, '_soilOut', n, Float32Array)
	const inSum = /** @type {Float32Array} */ scratch(w, '_soilIn', n, Float32Array)
	const delta = /** @type {Float32Array} */ scratch(w, '_soilDelta', n, Float32Array)
	outSum.fill(0)
	inSum.fill(0)
	delta.fill(0)

	for (let k = 0; k < mvN; k++) outSum[mvFrom[k]] += mvAmt[k]
	for (let k = 0; k < feedN; k++) outSum[feedFrom[k]] += feedAmt[k]
	for (let k = 0; k < mvN; k++) {
		const cap = moisture[mvFrom[k]]
		if (outSum[mvFrom[k]] > cap) mvAmt[k] *= cap / outSum[mvFrom[k]]
	}
	for (let k = 0; k < feedN; k++) {
		const cap = moisture[feedFrom[k]]
		if (outSum[feedFrom[k]] > cap) feedAmt[k] *= cap / outSum[feedFrom[k]]
	}

	for (let k = 0; k < mvN; k++) inSum[mvTo[k]] += mvAmt[k]
	for (let k = 0; k < mvN; k++) {
		const room = Math.max(0, SOIL_CAP - moisture[mvTo[k]])
		if (inSum[mvTo[k]] > room && inSum[mvTo[k]] > 1e-12)
			mvAmt[k] *= room / inSum[mvTo[k]]
	}

	for (let k = 0; k < mvN; k++) {
		delta[mvFrom[k]] -= mvAmt[k]
		delta[mvTo[k]] += mvAmt[k]
	}
	for (let k = 0; k < feedN; k++) {
		const from = feedFrom[k]
		const amt = feedAmt[k]
		delta[from] -= amt
		const y = from / W | 0
		if (y + 1 >= H) continue
		const bi = from + W
		if (mat[bi] === MAT.AIR) condense[from] += amt
		else delta[from] += amt
	}
	for (let i = 0; i < n; i++) {
		if (!delta[i]) continue
		moisture[i] += delta[i]
		if (moisture[i] < 0) moisture[i] = 0
		else if (moisture[i] > SOIL_CAP) moisture[i] = SOIL_CAP
	}

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
			const take = Math.min(condense[poor] * COND_MATTHEW_RATE, Math.abs(bias) * COND_MATTHEW_RATE)
			if (take <= 1e-8) continue
			condense[poor] -= take
			condense[rich] += take
		}

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
	const flowX = /** @type {Float32Array} */ scratch(w, '_liqFlowX', n, Float32Array)
	const flowY = /** @type {Float32Array} */ scratch(w, '_liqFlowY', n, Float32Array)
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
	const { worldW: W, worldH: H, gasUx, gasUy, mat, liq } = w
	for (const p of w.pendingSplash)
		if (w.particles.length + next.length < 1200)
			next.push(p)

	w.pendingSplash.length = 0

	for (const p of w.particles) {
		const gx = p.x | 0
		const gy = p.y | 0
		let ux = 0
		let uy = 0
		if (gx >= 0 && gy >= 0 && gx < W && gy < H) {
			const gi = gy * W + gx
			ux = gasUx[gi]
			uy = gasUy[gi]
		}
		p.vx += (ux - p.vx) * GAS_DRAG
		p.vy += (uy - p.vy) * GAS_DRAG_Y
		p.vy = Math.min(MAX_VY, p.vy + GRAVITY)
		p.life--
		if (p.life <= 0) continue

		const nx = p.x + p.vx
		const ny = p.y + p.vy

		if (nx < 0 || nx >= W || ny >= H) continue
		if (ny < 0) {
			p.x = nx
			p.y = ny
			next.push(p)
			continue
		}

		const cx = nx | 0
		const cy = ny | 0
		if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue

		const i = cy * W + cx
		const m = mat[i]
		const wet = liq[i] >= LIQ_DRAW

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
