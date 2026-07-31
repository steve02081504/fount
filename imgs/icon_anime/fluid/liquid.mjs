/**
 * Grid liquid: hydrostatic pressure drives all free-liquid mass transfer.
 *
 * P = P_air(surface) + RHO_G·depth. Orifices / gravity / submerged vents use
 * Torricelli √(ΔP/ρg). Free-surface sheets equalize fill only. Communicating
 * vessels relax φ = P/(ρg)−y along the liquid graph (no teleport). Sealed gas
 * with P > liquid P blocks invasion and pushes adjacent liquid away. Wind on
 * free surfaces shears sheet flow. Soil seepage is a separate moisture field.
 */

import { ORTHO_DX, ORTHO_DY } from '../hash.mjs'

import {
	pressureMove, sheetMove, applyTransfer, hydraulicPhi, P_FLOW_GAIN,
} from './flow.mjs'
import { labelAirRegions, pressureAt, gasUxAt } from './gas.mjs'
import {
	MAT, P_ATM, RHO_G, LIQ_DRAW, LIQ_FULL, SOIL_CAP,
	SOIL_ABSORB_RATE, SOIL_SIDE_FRAC, SOIL_DOWN_FRAC, SOIL_CONDENSE_FRAC,
	COND_DRIP, COND_MATTHEW_RATE, COND_MATTHEW_NOISE,
	isSoilMat, isLiquidBarrier, soilAbsorbFactor,
} from './mat.mjs'
import {
	scratch, growScratch, idx, inWorld, addLiquid,
	floodClear, floodPush, markAirIfDrawCrossed,
} from './world.mjs'

/** @typedef {import('./world.mjs').FluidWorld} FluidWorld */

/** Horizontal wind → free-surface sheet coupling (cells / tick per gas ux). */
const WIND_SHEET = 0.12
/** Max wind-driven sheet mass per edge per tick. */
const WIND_SHEET_CAP = 0.18

/**
 * Whether free liquid can enter `(x, y)`.
 * @param {FluidWorld} world fluid world
 * @param {number} x column
 * @param {number} y row
 * @returns {boolean} true when the cell accepts liquid
 */
const canOccupy = (world, x, y) => {
	if (x < 0 || y < 0 || x >= world.worldW || y >= world.worldH) return false
	const cell = y * world.worldW + x
	const m = world.mat[cell]
	if (isLiquidBarrier(m)) return false
	if (m === MAT.POOL) return world.liq[cell] < LIQ_FULL
	return true
}

/**
 * Hydrostatic depth pressure: P_air(surface) + RHO_G·(depth + partial fill).
 * Shared by `liquidPressureAt` and the column-pressure cache.
 * @param {number} airP air pressure at the free-surface row
 * @param {number} y current row
 * @param {number} surf free-surface row
 * @param {number} amount liquid fill in the cell
 * @returns {number} hydrostatic pressure at the cell
 */
const columnDepthPressure = (airP, y, surf, amount) =>
	airP + RHO_G * ((y - surf) + Math.min(1, Math.max(amount, LIQ_DRAW)))

/**
 * Hydrostatic liquid pressure at `(x, y)`.
 * Air / dry cells → gas `pressureAt`. Wet cells → P_air(free surface) + RHO_G·depth.
 * @param {FluidWorld} world fluid world
 * @param {number} x column
 * @param {number} y row
 * @returns {number} liquid pressure at `(x, y)`
 */
export const liquidPressureAt = (world, x, y) => {
	if (!inWorld(world, x, y)) return pressureAt(world, x, Math.max(0, y))
	const cell = idx(world, x, y)
	const L = world.liq[cell]
	if (L < LIQ_DRAW && !isLiquidBarrier(world.mat[cell]))
		return pressureAt(world, x, y)

	let surf = y
	while (surf > 0) {
		const above = idx(world, x, surf - 1)
		if (isLiquidBarrier(world.mat[above])) break
		if (world.liq[above] < LIQ_DRAW) break
		surf--
	}

	const airY = surf > 0 && !isLiquidBarrier(world.mat[idx(world, x, surf - 1)]) ? surf - 1 : surf
	const airP = pressureAt(world, x, airY)
	return columnDepthPressure(airP, y, surf, L)
}

/**
 * Fill pressure cache for one column (matches `liquidPressureAt`).
 * @param {FluidWorld} world fluid world
 * @param {number} x column
 * @param {Float32Array} cache pressure buffer
 */
const fillColumnPressure = (world, x, cache) => {
	const { worldW: W, worldH: H, mat, liq } = world
	let y = 0
	while (y < H) {
		const cell = y * W + x
		const L = liq[cell]
		if (L < LIQ_DRAW && !isLiquidBarrier(mat[cell])) {
			cache[cell] = pressureAt(world, x, y)
			y++
			continue
		}
		const surf = y
		const airY = surf > 0 && !isLiquidBarrier(mat[(surf - 1) * W + x]) ? surf - 1 : surf
		const airP = pressureAt(world, x, airY)
		while (y < H) {
			const ci = y * W + x
			const Li = liq[ci]
			if (Li < LIQ_DRAW && !isLiquidBarrier(mat[ci])) break
			cache[ci] = columnDepthPressure(airP, y, surf, Li)
			y++
		}
	}
}

/**
 * Free-surface cell? (air or barrier above, or top of world.)
 * @param {FluidWorld} world fluid world
 * @param {number} cell flat index
 * @param {number} y row
 * @returns {boolean} true when liquid meets air above
 */
const isFreeSurface = (world, cell, y) =>
	y === 0 || isLiquidBarrier(world.mat[cell - world.worldW]) || world.liq[cell - world.worldW] < LIQ_DRAW

/**
 * POOL retain: keep mass until near-full unless draining into another POOL.
 * @param {FluidWorld} world fluid world
 * @param {number} src source index
 * @param {number} dst dest index
 * @returns {boolean} true when transfer should be blocked
 */
const poolRetainBlocks = (world, src, dst) =>
	world.mat[src] === MAT.POOL && world.mat[dst] !== MAT.POOL && world.liq[src] < 0.92

/**
 * Sealed over-pressure at an air neighbor blocks invasion.
 * @param {FluidWorld} world fluid world
 * @param {number} neighbor dest index
 * @param {number} pSrc liquid pressure at source
 * @returns {boolean} true when sealed gas blocks the move
 */
const sealedGasBlocks = (world, neighbor, pSrc) => {
	if (world.liq[neighbor] > 0.05) return false
	const rid = world.regionId[neighbor]
	if (!rid) return false
	const region = world.regions[rid]
	return !!(region && !region.openToAtm && region.pressure > pSrc + 0.05)
}

/**
 * Transfer mass and dirty air when a cell crosses the free-liquid draw threshold.
 * @param {FluidWorld} world fluid world
 * @param {Float32Array} liq liquid field
 * @param {Float32Array} flowX horizontal flow
 * @param {Float32Array} flowY vertical flow
 * @param {number} src source index
 * @param {number} dst dest index
 * @param {number} dx horizontal step
 * @param {number} dy vertical step
 * @param {number} move mass
 * @returns {number} mass moved
 */
const transfer = (world, liq, flowX, flowY, src, dst, dx, dy, move) => {
	const a0 = liq[src]
	const b0 = liq[dst]
	const m = applyTransfer(liq, flowX, flowY, src, dst, dx, dy, move)
	if (m > 0) {
		markAirIfDrawCrossed(world, a0, liq[src])
		markAirIfDrawCrossed(world, b0, liq[dst])
	}
	return m
}

/**
 * Push one free-surface sample into reused SoA scratch (components stay contiguous).
 * @param {FluidWorld} world fluid world
 * @param {number} x column
 * @param {number} y row
 * @param {number} component component id
 * @param {number} pressure air pressure above surface
 * @param {{
 *   x: Int32Array, y: Int32Array, c: Int32Array, p: Float32Array, n: number,
 * }} surf surface SoA
 */
const pushSurface = (world, x, y, component, pressure, surf) => {
	const n = surf.n
	if (n >= surf.x.length) {
		surf.x = growScratch(world, 'liqSurfX', n + 1, Int32Array)
		surf.y = growScratch(world, 'liqSurfY', n + 1, Int32Array)
		surf.c = growScratch(world, 'liqSurfC', n + 1, Int32Array)
		surf.p = growScratch(world, 'liqSurfP', n + 1, Float32Array)
	}
	surf.x[n] = x
	surf.y[n] = y
	surf.c[n] = component
	surf.p[n] = pressure
	surf.n = n + 1
}

/**
 * Label connected liquid components; free surfaces as SoA (grouped by component).
 * @param {FluidWorld} world fluid world
 * @returns {{
 *   surf: { x: Int32Array, y: Int32Array, c: Int32Array, p: Float32Array, n: number },
 *   componentOf: Int32Array,
 * }} surface samples and per-cell component ids
 */
const labelLiquidComponents = (world) => {
	const { worldW: W, worldH: H, mat, liq } = world
	const n = W * H
	const componentOf = scratch(world, 'liqComp', n, Int32Array)
	componentOf.fill(0)
	const surf = {
		x: growScratch(world, 'liqSurfX', 64, Int32Array),
		y: growScratch(world, 'liqSurfY', 64, Int32Array),
		c: growScratch(world, 'liqSurfC', 64, Int32Array),
		p: growScratch(world, 'liqSurfP', 64, Float32Array),
		n: 0,
	}
	let next = 1

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (componentOf[cell] || liq[cell] < LIQ_DRAW || isLiquidBarrier(mat[cell])) continue
			const id = next++
			floodClear(world)
			floodPush(world, x, y)
			componentOf[cell] = id
			for (let qi = 0; qi < world.floodQ.length; qi += 2) {
				const cx = world.floodQ[qi]
				const cy = world.floodQ[qi + 1]
				const aboveY = cy - 1
				if (aboveY < 0)
					pushSurface(world, cx, cy, id, pressureAt(world, cx, 0), surf)
				else {
					const above = aboveY * W + cx
					if (!isLiquidBarrier(mat[above]) && liq[above] < LIQ_DRAW)
						pushSurface(world, cx, cy, id, pressureAt(world, cx, aboveY), surf)
				}
				for (let o = 0; o < 4; o++) {
					const nx = cx + ORTHO_DX[o]
					const ny = cy + ORTHO_DY[o]
					if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
					const neighbor = ny * W + nx
					if (componentOf[neighbor] || liq[neighbor] < LIQ_DRAW || isLiquidBarrier(mat[neighbor])) continue
					componentOf[neighbor] = id
					floodPush(world, nx, ny)
				}
			}
		}

	return { surf, componentOf }
}

/**
 * Path-respecting hydraulic equalize: BFS from the lowest-φ surface through the
 * liquid graph; cells push a trickle toward neighbors closer to that sink.
 * Surfaces are SoA; BFS uses a generation stamp (no whole-grid `dist.fill`).
 * @param {FluidWorld} world fluid world
 * @param {Float32Array} flowX flow accumulator
 * @param {Float32Array} flowY flow accumulator
 */
const equalizeHydraulicAlongGraph = (world, flowX, flowY) => {
	const { surf, componentOf } = labelLiquidComponents(world)
	const { worldW: W, worldH: H, liq } = world
	const n = W * H
	const dist = scratch(world, 'liqHydroDist', n, Int32Array)
	const visit = scratch(world, 'liqHydroVisit', n, Int32Array)
	let gen = (/** @type {number} */ world.scratch.liqHydroGen | 0) + 1
	if (gen >= 0x7fffffff) {
		visit.fill(0)
		gen = 1
	}
	world.scratch.liqHydroGen = gen

	const { x: sx, y: sy, c: sc, p: sp, n: surfN } = surf
	let i = 0
	while (i < surfN) {
		const comp = sc[i]
		const start = i
		while (i < surfN && sc[i] === comp) i++
		const end = i
		if (end - start < 2) continue

		let sink = start
		let sinkPhi = hydraulicPhi(sp[start], sy[start])
		for (let k = start + 1; k < end; k++) {
			const phi = hydraulicPhi(sp[k], sy[k])
			if (phi < sinkPhi) {
				sinkPhi = phi
				sink = k
			}
		}

		let need = false
		for (let k = start; k < end; k++) {
			if (k === sink) continue
			if (hydraulicPhi(sp[k], sy[k]) - sinkPhi > 0.35) {
				need = true
				break
			}
		}
		if (!need) continue

		floodClear(world)
		const sinkCell = sy[sink] * W + sx[sink]
		visit[sinkCell] = gen
		dist[sinkCell] = 0
		floodPush(world, sx[sink], sy[sink])
		for (let qi = 0; qi < world.floodQ.length; qi += 2) {
			const cx = world.floodQ[qi]
			const cy = world.floodQ[qi + 1]
			const d0 = dist[cy * W + cx]
			for (let o = 0; o < 4; o++) {
				const nx = cx + ORTHO_DX[o]
				const ny = cy + ORTHO_DY[o]
				if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
				const neighbor = ny * W + nx
				if (componentOf[neighbor] !== comp || visit[neighbor] === gen) continue
				visit[neighbor] = gen
				dist[neighbor] = d0 + 1
				floodPush(world, nx, ny)
			}
		}

		for (let k = start; k < end; k++) {
			if (k === sink) continue
			const phi = hydraulicPhi(sp[k], sy[k])
			const delta = phi - sinkPhi
			if (delta <= 0.35) continue
			const cell = sy[k] * W + sx[k]
			if (visit[cell] !== gen || liq[cell] < 0.05) continue
			let bestNeighbor = -1
			let bestD = dist[cell]
			let bestDx = 0
			let bestDy = 0
			const x0 = sx[k]
			const y0 = sy[k]
			for (let o = 0; o < 4; o++) {
				const dx = ORTHO_DX[o]
				const dy = ORTHO_DY[o]
				const nx = x0 + dx
				const ny = y0 + dy
				if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
				const neighbor = ny * W + nx
				if (componentOf[neighbor] !== comp || visit[neighbor] !== gen || dist[neighbor] >= bestD) continue
				if (liq[neighbor] >= LIQ_FULL - 1e-6) continue
				bestD = dist[neighbor]
				bestNeighbor = neighbor
				bestDx = dx
				bestDy = dy
			}
			if (bestNeighbor < 0) continue
			const move = Math.min(0.12, liq[cell] * 0.35, delta * 0.08)
			transfer(world, liq, flowX, flowY, cell, bestNeighbor, bestDx, bestDy, move)
		}
	}
}

/**
 * Clamp `moisture[cell]` into `[0, SOIL_CAP]` after applying accumulated delta.
 * @param {Float32Array} moisture soil moisture field
 * @param {number} cell flat index
 */
const clampMoisture = (moisture, cell) => {
	if (moisture[cell] < 0) moisture[cell] = 0
	else if (moisture[cell] > SOIL_CAP) moisture[cell] = SOIL_CAP
}

/**
 * Soil seepage: absorb free liquid, share moisture, feed condensation, Matthew drip, drip.
 * @param {FluidWorld} world fluid world
 */
export const stepSoil = (world) => {
	const { worldW: W, worldH: H, mat, liq, moisture, condense } = world
	const n = W * H
	world.soilStep = (world.soilStep + 1) | 0
	const step = world.soilStep

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (!isSoilMat(mat[cell]) || y === 0) continue
			const above = (y - 1) * W + x
			if (isLiquidBarrier(mat[above]) || liq[above] <= 0) continue
			const room = SOIL_CAP - moisture[cell]
			if (room <= 0) continue
			const rate = SOIL_ABSORB_RATE * soilAbsorbFactor(moisture[cell])
			if (rate <= 1e-8) continue
			const before = liq[above]
			const take = Math.min(before, room, rate)
			liq[above] -= take
			moisture[cell] += take
			markAirIfDrawCrossed(world, before, liq[above])
		}

	let mvFrom = growScratch(world, 'mvFrom', 256, Int32Array)
	let mvTo = growScratch(world, 'mvTo', 256, Int32Array)
	let mvAmt = growScratch(world, 'mvAmt', 256, Float32Array)
	let feedFrom = growScratch(world, 'feedFrom', 64, Int32Array)
	let feedAmt = growScratch(world, 'feedAmt', 64, Float32Array)
	let mvN = 0
	let feedN = 0

	/**
	 * Queue a soil→soil moisture transfer.
	 * @param {number} from source index
	 * @param {number} to dest index
	 * @param {number} amt mass
	 */
	const pushMv = (from, to, amt) => {
		if (mvN >= mvFrom.length) {
			mvFrom = growScratch(world, 'mvFrom', mvN + 1, Int32Array)
			mvTo = growScratch(world, 'mvTo', mvN + 1, Int32Array)
			mvAmt = growScratch(world, 'mvAmt', mvN + 1, Float32Array)
		}
		mvFrom[mvN] = from
		mvTo[mvN] = to
		mvAmt[mvN++] = amt
	}

	/**
	 * Queue a soil→condensation feed.
	 * @param {number} from source index
	 * @param {number} amt mass
	 */
	const pushFeed = (from, amt) => {
		if (feedN >= feedFrom.length) {
			feedFrom = growScratch(world, 'feedFrom', feedN + 1, Int32Array)
			feedAmt = growScratch(world, 'feedAmt', feedN + 1, Float32Array)
		}
		feedFrom[feedN] = from
		feedAmt[feedN++] = amt
	}

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (!isSoilMat(mat[cell])) continue
			const m = moisture[cell]
			if (m <= 1e-8) continue

			if (y + 1 < H) {
				const below = (y + 1) * W + x
				if (isSoilMat(mat[below])) {
					const take = Math.min(m * SOIL_DOWN_FRAC, Math.max(0, SOIL_CAP - moisture[below]))
					if (take > 1e-8) pushMv(cell, below, take)
				}
				else if (mat[below] === MAT.AIR) {
					const take = m * SOIL_CONDENSE_FRAC
					if (take > 1e-8) pushFeed(cell, take)
				}
			}

			const left = x > 0 && isSoilMat(mat[cell - 1]) ? cell - 1 : -1
			const right = x + 1 < W && isSoilMat(mat[cell + 1]) ? cell + 1 : -1
			const sideN = (left >= 0 ? 1 : 0) + (right >= 0 ? 1 : 0)
			if (sideN) {
				const each = (m * SOIL_SIDE_FRAC) / sideN
				if (left >= 0) {
					const take = Math.min(each, Math.max(0, SOIL_CAP - moisture[left]))
					if (take > 1e-8) pushMv(cell, left, take)
				}
				if (right >= 0) {
					const take = Math.min(each, Math.max(0, SOIL_CAP - moisture[right]))
					if (take > 1e-8) pushMv(cell, right, take)
				}
			}
		}

	const outSum = scratch(world, 'soilOut', n, Float32Array)
	const inSum = scratch(world, 'soilIn', n, Float32Array)
	const delta = scratch(world, 'soilDelta', n, Float32Array)
	// Clear only touched indices — not the whole WH grid.
	for (let k = 0; k < mvN; k++) {
		outSum[mvFrom[k]] = 0
		outSum[mvTo[k]] = 0
		inSum[mvTo[k]] = 0
		delta[mvFrom[k]] = 0
		delta[mvTo[k]] = 0
	}
	for (let k = 0; k < feedN; k++) {
		outSum[feedFrom[k]] = 0
		delta[feedFrom[k]] = 0
	}

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
		const below = from + W
		if (mat[below] === MAT.AIR) condense[from] += amt
		else delta[from] += amt
	}
	for (let k = 0; k < mvN; k++) {
		const cell = mvFrom[k]
		if (!delta[cell]) continue
		moisture[cell] += delta[cell]
		clampMoisture(moisture, cell)
		delta[cell] = 0
	}
	for (let k = 0; k < mvN; k++) {
		const cell = mvTo[k]
		if (!delta[cell]) continue
		moisture[cell] += delta[cell]
		clampMoisture(moisture, cell)
		delta[cell] = 0
	}
	for (let k = 0; k < feedN; k++) {
		const cell = feedFrom[k]
		if (!delta[cell]) continue
		moisture[cell] += delta[cell]
		clampMoisture(moisture, cell)
		delta[cell] = 0
	}

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W - 1; x++) {
			const cell = y * W + x
			const right = cell + 1
			if (!isSoilMat(mat[cell]) || !isSoilMat(mat[right])) continue
			const ca = condense[cell]
			const cb = condense[right]
			if (ca < 1e-8 || cb < 1e-8) continue
			const mass = ca + cb
			// Cheap LCG — Matthew only needs jitter, not cryptographic randomness.
			const noise = ((((cell * 374761393) ^ (right * 668265263) ^ (step * 1274126177)) >>> 0) / 4294967296 - 0.5)
				* COND_MATTHEW_NOISE * mass
			const bias = (ca - cb) + noise
			if (Math.abs(bias) < 1e-8) continue
			const rich = bias > 0 ? cell : right
			const poor = bias > 0 ? right : cell
			const take = Math.min(condense[poor] * COND_MATTHEW_RATE, Math.abs(bias) * COND_MATTHEW_RATE)
			if (take <= 1e-8) continue
			condense[poor] -= take
			condense[rich] += take
		}

	for (let y = 0; y < H - 1; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (!isSoilMat(mat[cell]) || condense[cell] < COND_DRIP) continue
			const below = (y + 1) * W + x
			if (mat[below] !== MAT.AIR) continue
			const amt = condense[cell]
			const added = addLiquid(world, x, y + 1, amt)
			condense[cell] = amt - added
		}
}

/**
 * Liquid step: pressure-driven settle, wind sheet, soil, graph hydraulic equalize.
 * Re-labels air only when particles / lift dirtied free-liquid topology.
 * @param {FluidWorld} world fluid world
 */
export const stepLiquid = (world) => {
	const { worldW: W, worldH: H, mat, liq, liqVx, liqVy } = world
	if (world.airDirty) labelAirRegions(world)

	const n = W * H
	const flowX = scratch(world, 'liqFlowX', n, Float32Array)
	const flowY = scratch(world, 'liqFlowY', n, Float32Array)
	const colDirty = scratch(world, 'liqColDirty', W, Uint8Array)
	flowX.fill(0)
	flowY.fill(0)
	colDirty.fill(0)

	const pCache = scratch(world, 'liqP', n, Float32Array)
	for (let x = 0; x < W; x++) fillColumnPressure(world, x, pCache)

	/**
	 * Cached pressure (O(1)); falls back off-grid to gas hydro.
	 * @param {number} x column
	 * @param {number} y row
	 * @returns {number} cached liquid/gas pressure
	 */
	const pAt = (x, y) => {
		if (x < 0 || y < 0 || x >= W || y >= H) return pressureAt(world, x, Math.max(0, y))
		return pCache[y * W + x]
	}

	// --- Vertical settle: column-major; refresh a column only after it transfers ---
	for (let x = 0; x < W; x++) 
		for (let y = H - 2; y >= 0; y--) {
			const cell = y * W + x
			if (liq[cell] <= 0) continue
			if (isLiquidBarrier(mat[cell])) {
				const before = liq[cell]
				liq[cell] = 0
				markAirIfDrawCrossed(world, before, 0)
				continue
			}
			const below = cell + W
			if (isLiquidBarrier(mat[below]) || liq[below] >= LIQ_FULL) continue
			if (poolRetainBlocks(world, cell, below)) continue

			const pSrc = pAt(x, y)
			const pDst = pAt(x, y + 1)
			const room = LIQ_FULL - liq[below]
			let move = pressureMove(pSrc, pDst, liq[cell], room)
			// Near-equal stacked fills: still drain residual head into emptier below
			// when destination gas is not strongly over-pressured.
			if (move < 0.01 && liq[below] < liq[cell] && pDst < pSrc + RHO_G * 0.85)
				move = Math.min(liq[cell], room, Math.max(0.08, (liq[cell] - liq[below]) * 0.85))
			if (move > 0) {
				transfer(world, liq, flowX, flowY, cell, below, 0, 1, move)
				fillColumnPressure(world, x, pCache)
				continue
			}

			// Diagonal settle into emptier down-slope when blocked straight down.
			const dir = (x + y) & 1 ? 1 : -1
			let didDiag = false
			for (let pass = 0; pass < 2; pass++) {
				const dx = pass === 0 ? dir : -dir
				const nx = x + dx
				const ny = y + 1
				if (!canOccupy(world, nx, ny)) continue
				const neighbor = ny * W + nx
				if (liq[neighbor] >= liq[cell] || poolRetainBlocks(world, cell, neighbor)) continue
				const pN = liquidPressureAt(world, nx, ny)
				let m = pressureMove(pSrc, pN, liq[cell] * 0.5, LIQ_FULL - liq[neighbor])
				if (m <= 0.01)
					m = Math.min(liq[cell] * 0.5, (liq[cell] - liq[neighbor]) * 0.5, LIQ_FULL - liq[neighbor])
				if (m <= 0.01) continue
				transfer(world, liq, flowX, flowY, cell, neighbor, dx, 1, m)
				fillColumnPressure(world, x, pCache)
				fillColumnPressure(world, nx, pCache)
				didDiag = true
				break
			}
			if (didDiag) continue
		}
	

	// Vertical transfers already refreshed dirty columns — no second full WH fill.

	// --- Horizontal: free-surface sheet / submerged orifice / edge vent / wind ---
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (liq[cell] <= 0.05 || isLiquidBarrier(mat[cell])) continue
			const pSrc = pAt(x, y)
			const freeSurface = isFreeSurface(world, cell, y)

			for (let pass = 0; pass < 2; pass++) {
				const dx = pass === 0 ? -1 : 1
				const nx = x + dx
				if (nx < 0 || nx >= W) {
					const before = liq[cell]
					const move = freeSurface
						? before * 0.25
						: Math.min(
							before,
							Math.max(before * 0.2, Math.sqrt(Math.max(0, (pSrc - pressureAt(world, x, y)) / RHO_G)) * P_FLOW_GAIN),
						)
					liq[cell] -= move
					flowX[cell] += dx * move
					markAirIfDrawCrossed(world, before, liq[cell])
					colDirty[x] = 1
					continue
				}
				const neighbor = cell + dx
				if (isLiquidBarrier(mat[neighbor])) continue
				if (poolRetainBlocks(world, cell, neighbor) && mat[neighbor] === MAT.AIR) continue
				if (sealedGasBlocks(world, neighbor, pSrc)) continue

				const pDst = pAt(nx, y)
				const room = LIQ_FULL - liq[neighbor]
				let move = 0
				if (freeSurface && liq[neighbor] < LIQ_DRAW)
					move = sheetMove(liq[cell], liq[neighbor], room)
				else {
					if (pDst >= pSrc - 0.02 && liq[neighbor] >= liq[cell] - 0.02) continue
					move = pressureMove(pSrc, pDst, liq[cell], room)
					if (move < 0.01 && liq[neighbor] < liq[cell] - 0.02)
						move = Math.min((liq[cell] - liq[neighbor]) * 0.25, room)
				}

				// Wind shear on free-surface sheets — gas ux pushes mass downwind.
				if (freeSurface && liq[cell] >= LIQ_DRAW) {
					const ux = gasUxAt(world, x, y > 0 ? y - 1 : y)
					if (ux * dx > 0.15) {
						const wind = Math.min(WIND_SHEET_CAP, Math.abs(ux) * WIND_SHEET, liq[cell] * 0.2, room)
						move = Math.max(move, wind)
					}
				}

				if (move > 0) {
					transfer(world, liq, flowX, flowY, cell, neighbor, dx, 0, move)
					colDirty[x] = 1
					colDirty[nx] = 1
				}
			}
		}

	for (let x = 0; x < W; x++)
		if (colDirty[x]) fillColumnPressure(world, x, pCache)

	// --- Sealed gas pushes adjacent free liquid away (down preferred, else sideways) ---
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			const rid = world.regionId[cell]
			if (!rid || liq[cell] >= LIQ_DRAW) continue
			const region = world.regions[rid]
			if (!region || region.openToAtm || region.pressure <= P_ATM * 1.2) continue
			const gasP = region.pressure
			for (let o = 0; o < 4; o++) {
				const dx = ORTHO_DX[o]
				const dy = ORTHO_DY[o]
				const nx = x + dx
				const ny = y + dy
				if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
				const neighbor = ny * W + nx
				if (liq[neighbor] < LIQ_DRAW || isLiquidBarrier(mat[neighbor])) continue
				const lP = pAt(nx, ny)
				if (gasP <= lP + 0.08) continue
				const push = Math.min(0.2, liq[neighbor] * 0.35, (gasP - lP) * 0.15)
				if (push < 0.02) continue
				const tx = nx + dx
				const ty = ny + (dy === 0 ? 1 : dy)
				if (canOccupy(world, tx, ty) && liq[idx(world, tx, ty)] < LIQ_FULL) {
					const target = idx(world, tx, ty)
					transfer(world, liq, flowX, flowY, neighbor, target, tx - nx, ty - ny, push)
				}
				else if (dy === 0 && ny + 1 < H && canOccupy(world, nx, ny + 1)) {
					const target = idx(world, nx, ny + 1)
					transfer(world, liq, flowX, flowY, neighbor, target, 0, 1, push)
				}
			}
		}

	stepSoil(world)
	equalizeHydraulicAlongGraph(world, flowX, flowY)

	for (let x = 0; x < W; x++) {
		const cell = (H - 1) * W + x
		const before = liq[cell]
		liq[cell] = 0
		markAirIfDrawCrossed(world, before, 0)
	}

	for (let i = 0; i < n; i++) {
		const m = liq[i]
		if (m < 1e-6) {
			liqVx[i] = 0
			liqVy[i] = 0
			continue
		}
		liqVx[i] = liqVx[i] * 0.35 + (flowX[i] / m) * 0.65
		liqVy[i] = liqVy[i] * 0.35 + (flowY[i] / m) * 0.65
	}
}
