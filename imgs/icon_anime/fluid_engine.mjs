/**
 * Particle / grid-liquid / pressure engine for ASCII scenes.
 *
 * Air regions carry conserved gas mass; sealed cavities follow isothermal Boyle:
 *   P / P_atm = gasAmount / airVolume
 * Communicating vessels equalize hydraulic potential:
 *   φ = P / (ρg) - surfaceY
 */

/** @typedef {{
 *   viewW: number, viewH: number, worldW: number, worldH: number,
 *   margin: number, ox: number, oy: number,
 *   mat: Uint8Array, liq: Float32Array, absorb: Float32Array,
 *   regionId: Int32Array,
 *   regions: Map<number, AirRegion>,
 *   particles: FluidParticle[], pendingSplash: FluidParticle[],
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
 * @typedef {{ x: number, y: number, vx: number, vy: number, life: number }} FluidParticle
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
}

/**
 *
 */
export const P_ATM = 1
/**
 *
 */
export const RHO_G = 1

/**
 * @param {number} m parameter
 * @returns {boolean} result
 */
export const isSolidMat = m =>
	m === MAT.SOLID || m === MAT.SLOPE_L || m === MAT.SLOPE_R || m === MAT.HORIZON

/**
 * @param {number} m parameter
 * @returns {boolean} result
 */
export const isBlockMat = m => isSolidMat(m) || m === MAT.POOL || m === MAT.BODY

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
		absorb: new Float32Array(size),
		regionId: new Int32Array(size),
		regions: new Map(),
		particles: /** @type {FluidParticle[]} */ [],
		pendingSplash: /** @type {FluidParticle[]} */ [],
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
	w.particles.length = 0
	w.pendingSplash.length = 0
	w.regionId.fill(0)
	w.regions.clear()
}

/**
 * @param {FluidWorld} w parameter
 * @returns {void} result
 */
export const clearMaterials = (w) => {
	w.mat.fill(MAT.AIR)
	w.absorb.fill(0)
}

/**
 * @param {FluidWorld} w parameter
 * @param {number} x parameter
 * @param {number} y parameter
 * @param {number} m parameter
 * @param {number} [absorb=0] parameter
 * @returns {void} result
 */
export const setMat = (w, x, y, m, absorb = 0) => {
	if (!inWorld(w, x, y)) return
	const i = idx(w, x, y)
	w.mat[i] = m
	if (m === MAT.HORIZON) w.absorb[i] = absorb
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
	if (isSolidMat(w.mat[i])) return 0
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
 * @returns {void} result
 */
export const spawnParticle = (w, x, y, vx, vy, life = 40) => {
	if (w.particles.length > 1200) return
	w.particles.push({ x, y, vx, vy, life })
}

/**
 * @param {FluidWorld} w parameter
 * @param {number} x parameter
 * @param {number} y parameter
 * @param {number} vx parameter
 * @param {number} vy parameter
 * @param {number} [life=18] parameter
 * @returns {void} result
 */
export const queueSplash = (w, x, y, vx, vy, life = 18) => {
	w.pendingSplash.push({ x, y, vx, vy, life })
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
		if (isSolidMat(w.mat[ii])) break
		const r2 = w.regionId[ii]
		if (r2) {
			const r = w.regions.get(r2)
			return r ? r.pressure : P_ATM
		}
	}
	return P_ATM
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
	if (isSolidMat(m)) return false
	if (m === MAT.POOL || m === MAT.BODY) return w.liq[i] < LIQ_FULL
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
			if (componentOf[i] || liq[i] < LIQ_DRAW || isSolidMat(mat[i])) continue
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
					if (componentOf[ni] || liq[ni] < LIQ_DRAW || isSolidMat(mat[ni])) continue
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
				if (isSolidMat(mat[ai])) continue
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
 * Liquid step: gravity, side flow (pressure-gated), hydraulic equalization.
 * @param {FluidWorld} w parameter
 * @returns {void} result
 */
export const stepLiquid = (w) => {
	const { worldW: W, worldH: H, mat, liq } = w
	labelAirRegions(w)

	// Gravity
	for (let y = H - 2; y >= 0; y--)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			if (liq[i] <= 0) continue
			if (isSolidMat(mat[i])) {
				liq[i] = 0
				continue
			}
			const below = (y + 1) * W + x
			if (!isSolidMat(mat[below]) && mat[below] !== MAT.BODY && liq[below] < LIQ_FULL) {
				// sealed cavity below with high pressure resists inflow
				const pBelow = pressureAt(w, x, y + 1)
				const resist = Math.max(0, (pBelow - P_ATM) * 0.35)
				const capacity = Math.max(0, LIQ_FULL - liq[below] - resist)
				const move = Math.min(liq[i], capacity)
				liq[i] -= move
				liq[below] += move
				continue
			}
			const dir = (x + y) & 1 ? 1 : -1
			for (const dx of [dir, -dir]) {
				const nx = x + dx
				const ny = y + 1
				if (!canOccupy(w, nx, ny)) continue
				const ni = ny * W + nx
				if (liq[ni] >= liq[i]) continue
				const move = Math.min(liq[i] * 0.5, (liq[i] - liq[ni]) * 0.5, LIQ_FULL - liq[ni])
				if (move <= 0.01) continue
				liq[i] -= move
				liq[ni] += move
				break
			}
		}

	// Horizontal spread — allow into sealed dry cells only if pressure permits (compression)
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			if (liq[i] <= 0.05) continue
			if (isSolidMat(mat[i])) continue
			for (const dx of [-1, 1]) {
				const nx = x + dx
				if (nx < 0 || nx >= W) {
					liq[i] *= 0.5
					continue
				}
				const ni = y * W + nx
				if (isSolidMat(mat[ni]) || mat[ni] === MAT.BODY) continue
				const targetDrySealed = liq[ni] <= 0.05 && w.regionId[ni] && !w.regions.get(w.regionId[ni])?.openToAtm
				if (targetDrySealed) {
					const r = w.regions.get(w.regionId[ni])
					if (r && r.pressure > P_ATM * 1.15) continue // compressed — resist
				}
				if (liq[ni] >= liq[i] - 0.02) continue
				const move = Math.min((liq[i] - liq[ni]) * 0.25, LIQ_FULL - liq[ni])
				liq[i] -= move
				liq[ni] += move
			}
		}

	equalizeHydraulic(w)

	// Recompute pressures after liquid moved (volumes changed)
	labelAirRegions(w)

	for (let x = 0; x < W; x++)
		liq[(H - 1) * W + x] = 0
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
 * @param {number} yf parameter
 * @param {boolean} fast parameter
 * @returns {string} result
 */
export const rainChar = (yf, fast) => {
	if (fast) return '|'
	const u = ((yf % 1) + 1) % 1
	if (u < 0.35) return '\''
	if (u < 0.7) return '.'
	return ','
}

/**
 * Liquid glyph by fill amount.
 * @param {number} amount parameter
 * @param {number} phase parameter
 * @returns {string} result
 */
export const liquidChar = (amount, phase) => {
	if (amount >= 0.85) return '~'
	if (amount >= 0.55) return phase & 1 ? '≈' : '~'
	if (amount >= LIQ_DRAW) return phase & 1 ? ',' : '.'
	return ' '
}

/** Draw threshold for free liquid. */
export const LIQUID_DRAW_THRESHOLD = LIQ_DRAW

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
