/**
 * Grid liquid: hydrostatic pressure drives all free-liquid mass transfer.
 *
 * P = P_air(surface) + RHO_G·depth. Orifices / gravity / submerged vents use
 * Torricelli √(ΔP/ρg). Free-surface sheets equalize fill only. Communicating
 * vessels relax φ = P/(ρg)−y along the liquid graph (no teleport). Sealed gas
 * with P > liquid P blocks invasion and pushes adjacent liquid away. Wind on
 * free surfaces shears sheet flow. Soil seepage is a separate moisture field.
 */

import { hash01, ORTHO } from '../hash.mjs'

import {
	pressureMove, sheetMove, applyTransfer, hydraulicPhi, P_FLOW_GAIN,
} from './flow.mjs'
import { labelAirRegions, pressureAt, gasVelocityAt } from './gas.mjs'
import {
	MAT, P_ATM, RHO_G, LIQ_DRAW, LIQ_FULL, SOIL_CAP,
	SOIL_ABSORB_RATE, SOIL_SIDE_FRAC, SOIL_DOWN_FRAC, SOIL_CONDENSE_FRAC,
	COND_DRIP, COND_MATTHEW_RATE, COND_MATTHEW_NOISE,
	isSoilMat, isLiquidBarrier, soilAbsorbFactor,
} from './mat.mjs'
import { scratch, growScratch, idx, inWorld, addLiquid } from './world.mjs'

/** @typedef {import('./world.mjs').FluidWorld} FluidWorld */

/** Horizontal wind → free-surface sheet coupling (cells / tick per gas ux). */
const WIND_SHEET = 0.12
/** Max wind-driven sheet mass per edge per tick. */
const WIND_SHEET_CAP = 0.18

/**
 * Whether free liquid can enter `(x, y)`.
 * @param {FluidWorld} w world
 * @param {number} x column
 * @param {number} y row
 * @returns {boolean} occupiable
 */
const canOccupy = (w, x, y) => {
	if (x < 0 || y < 0 || x >= w.worldW || y >= w.worldH) return false
	const i = y * w.worldW + x
	const m = w.mat[i]
	if (isLiquidBarrier(m)) return false
	if (m === MAT.POOL) return w.liq[i] < LIQ_FULL
	return true
}

/**
 * Hydrostatic liquid pressure at `(x, y)`.
 * Air / dry cells → gas `pressureAt`. Wet cells → P_air(free surface) + RHO_G·depth.
 * @param {FluidWorld} w world
 * @param {number} x column
 * @param {number} y row
 * @returns {number} pressure
 */
export const liquidPressureAt = (w, x, y) => {
	if (!inWorld(w, x, y)) return pressureAt(w, x, Math.max(0, y))
	const i = idx(w, x, y)
	const L = w.liq[i]
	if (L < LIQ_DRAW && !isLiquidBarrier(w.mat[i]))
		return pressureAt(w, x, y)

	let surf = y
	while (surf > 0) {
		const above = idx(w, x, surf - 1)
		if (isLiquidBarrier(w.mat[above])) break
		if (w.liq[above] < LIQ_DRAW) break
		surf--
	}

	const airY = surf > 0 && !isLiquidBarrier(w.mat[idx(w, x, surf - 1)]) ? surf - 1 : surf
	const airP = pressureAt(w, x, airY)
	const depth = (y - surf) + Math.min(1, Math.max(L, LIQ_DRAW))
	return airP + RHO_G * depth
}

/**
 * Free-surface cell? (air or barrier above, or top of world.)
 * @param {FluidWorld} w world
 * @param {number} i flat index
 * @param {number} y row
 * @returns {boolean} free surface
 */
const isFreeSurface = (w, i, y) =>
	y === 0 || isLiquidBarrier(w.mat[i - w.worldW]) || w.liq[i - w.worldW] < LIQ_DRAW

/**
 * POOL retain: keep mass until near-full unless draining into another POOL.
 * @param {FluidWorld} w world
 * @param {number} i source index
 * @param {number} ni dest index
 * @returns {boolean} blocked by retain
 */
const poolRetainBlocks = (w, i, ni) =>
	w.mat[i] === MAT.POOL && w.mat[ni] !== MAT.POOL && w.liq[i] < 0.92

/**
 * Sealed over-pressure at an air neighbor blocks invasion.
 * @param {FluidWorld} w world
 * @param {number} ni dest index
 * @param {number} pSrc liquid pressure
 * @returns {boolean} blocked
 */
const sealedGasBlocks = (w, ni, pSrc) => {
	if (w.liq[ni] > 0.05) return false
	const rid = w.regionId[ni]
	if (!rid) return false
	const region = w.regions[rid]
	return !!(region && !region.openToAtm && region.pressure > pSrc + 0.05)
}

/**
 * Label connected liquid components; return free-surface samples + component map.
 * @param {FluidWorld} w world
 * @returns {{
 *   surfaces: { x: number, y: number, component: number, pressure: number }[],
 *   componentOf: Int32Array,
 * }} labels
 */
const labelLiquidComponents = (w) => {
	const { worldW: W, worldH: H, mat, liq } = w
	const n = W * H
	const componentOf = scratch(w, 'liqComp', n, Int32Array)
	componentOf.fill(0)
	let next = 1
	const surfaces = []
	const q = w.floodQ

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
					surfaces.push({ x: cx, y: cy, component: id, pressure: pressureAt(w, cx, 0) })
				else {
					const ai = aboveY * W + cx
					if (!isLiquidBarrier(mat[ai]) && liq[ai] < LIQ_DRAW)
						surfaces.push({
							x: cx, y: cy, component: id,
							pressure: pressureAt(w, cx, aboveY),
						})
				}
				for (const [dx, dy] of ORTHO) {
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
 * Path-respecting hydraulic equalize: BFS from the lowest-φ surface through the
 * liquid graph; cells push a trickle toward neighbors closer to that sink.
 * @param {FluidWorld} w world
 * @param {Float32Array} flowX flow accumulator
 * @param {Float32Array} flowY flow accumulator
 * @returns {void}
 */
const equalizeHydraulicAlongGraph = (w, flowX, flowY) => {
	const { surfaces, componentOf } = labelLiquidComponents(w)
	const { worldW: W, worldH: H, liq } = w
	const byComp = new Map()
	for (const s of surfaces) {
		let list = byComp.get(s.component)
		if (!list) byComp.set(s.component, list = [])
		list.push(s)
	}

	const dist = scratch(w, 'liqHydroDist', W * H, Int32Array)
	const q = w.floodQ

	for (const list of byComp.values()) {
		if (list.length < 2) continue

		let sink = list[0]
		let sinkPhi = hydraulicPhi(sink.pressure, sink.y)
		for (let i = 1; i < list.length; i++) {
			const phi = hydraulicPhi(list[i].pressure, list[i].y)
			if (phi < sinkPhi) {
				sinkPhi = phi
				sink = list[i]
			}
		}

		let need = false
		for (const s of list) {
			if (s === sink) continue
			if (hydraulicPhi(s.pressure, s.y) - sinkPhi > 0.35) {
				need = true
				break
			}
		}
		if (!need) continue

		const comp = sink.component
		dist.fill(-1)
		q.length = 0
		const sinkI = idx(w, sink.x, sink.y)
		dist[sinkI] = 0
		q.push(sink.x, sink.y)
		for (let qi = 0; qi < q.length; qi += 2) {
			const cx = q[qi]
			const cy = q[qi + 1]
			const ci = cy * W + cx
			const d0 = dist[ci]
			for (const [dx, dy] of ORTHO) {
				const nx = cx + dx
				const ny = cy + dy
				if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
				const ni = ny * W + nx
				if (componentOf[ni] !== comp || dist[ni] >= 0) continue
				dist[ni] = d0 + 1
				q.push(nx, ny)
			}
		}

		// High-φ surfaces feed mass toward the sink along descending BFS distance.
		for (const s of list) {
			if (s === sink) continue
			const phi = hydraulicPhi(s.pressure, s.y)
			const delta = phi - sinkPhi
			if (delta <= 0.35) continue
			const i = idx(w, s.x, s.y)
			if (dist[i] < 0 || liq[i] < 0.05) continue
			let bestNi = -1
			let bestD = dist[i]
			let bestDx = 0
			let bestDy = 0
			for (const [dx, dy] of ORTHO) {
				const nx = s.x + dx
				const ny = s.y + dy
				if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
				const ni = ny * W + nx
				if (componentOf[ni] !== comp || dist[ni] < 0 || dist[ni] >= bestD) continue
				if (liq[ni] >= LIQ_FULL - 1e-6) continue
				bestD = dist[ni]
				bestNi = ni
				bestDx = dx
				bestDy = dy
			}
			if (bestNi < 0) continue
			const move = Math.min(0.12, liq[i] * 0.35, delta * 0.08)
			applyTransfer(liq, flowX, flowY, i, bestNi, bestDx, bestDy, move)
		}
	}
}

/**
 * Soil seepage: absorb free liquid, share moisture, feed condensation, Matthew drip, drip.
 * @param {FluidWorld} w world
 * @returns {void}
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

	let mvFrom = growScratch(w, 'mvFrom', 256, Int32Array)
	let mvTo = growScratch(w, 'mvTo', 256, Int32Array)
	let mvAmt = growScratch(w, 'mvAmt', 256, Float32Array)
	let feedFrom = growScratch(w, 'feedFrom', 64, Int32Array)
	let feedAmt = growScratch(w, 'feedAmt', 64, Float32Array)
	let mvN = 0
	let feedN = 0

	/**
	 * Queue a soil→soil moisture transfer.
	 * @param {number} from source index
	 * @param {number} to dest index
	 * @param {number} amt mass
	 * @returns {void}
	 */
	const pushMv = (from, to, amt) => {
		if (mvN >= mvFrom.length) {
			mvFrom = growScratch(w, 'mvFrom', mvN + 1, Int32Array)
			mvTo = growScratch(w, 'mvTo', mvN + 1, Int32Array)
			mvAmt = growScratch(w, 'mvAmt', mvN + 1, Float32Array)
		}
		mvFrom[mvN] = from
		mvTo[mvN] = to
		mvAmt[mvN++] = amt
	}

	/**
	 * Queue a soil→condensation feed.
	 * @param {number} from source index
	 * @param {number} amt mass
	 * @returns {void}
	 */
	const pushFeed = (from, amt) => {
		if (feedN >= feedFrom.length) {
			feedFrom = growScratch(w, 'feedFrom', feedN + 1, Int32Array)
			feedAmt = growScratch(w, 'feedAmt', feedN + 1, Float32Array)
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

	const outSum = scratch(w, 'soilOut', n, Float32Array)
	const inSum = scratch(w, 'soilIn', n, Float32Array)
	const delta = scratch(w, 'soilDelta', n, Float32Array)
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
 * Liquid step: pressure-driven settle, wind sheet, soil, graph hydraulic equalize.
 * @param {FluidWorld} w world
 * @returns {void}
 */
export const stepLiquid = (w) => {
	const { worldW: W, worldH: H, mat, liq, liqVx, liqVy } = w
	labelAirRegions(w)

	const n = W * H
	const flowX = scratch(w, 'liqFlowX', n, Float32Array)
	const flowY = scratch(w, 'liqFlowY', n, Float32Array)
	flowX.fill(0)
	flowY.fill(0)

	// --- Vertical settle (top → bottom source scan): hydrostatic → Torricelli ---
	for (let y = H - 2; y >= 0; y--)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			if (liq[i] <= 0) continue
			if (isLiquidBarrier(mat[i])) {
				liq[i] = 0
				continue
			}
			const below = i + W
			if (isLiquidBarrier(mat[below]) || liq[below] >= LIQ_FULL) continue
			if (poolRetainBlocks(w, i, below)) continue

			const pSrc = liquidPressureAt(w, x, y)
			const pDst = liquidPressureAt(w, x, y + 1)
			const room = LIQ_FULL - liq[below]
			let move = pressureMove(pSrc, pDst, liq[i], room)
			// Near-equal stacked fills: still drain residual head into emptier below
			// when destination gas is not strongly over-pressured.
			if (move < 0.01 && liq[below] < liq[i] && pDst < pSrc + RHO_G * 0.85)
				move = Math.min(liq[i], room, Math.max(0.08, (liq[i] - liq[below]) * 0.85))
			if (move > 0) {
				applyTransfer(liq, flowX, flowY, i, below, 0, 1, move)
				continue
			}

			// Diagonal settle into emptier down-slope when blocked straight down.
			const dir = (x + y) & 1 ? 1 : -1
			for (const dx of [dir, -dir]) {
				const nx = x + dx
				const ny = y + 1
				if (!canOccupy(w, nx, ny)) continue
				const ni = ny * W + nx
				if (liq[ni] >= liq[i] || poolRetainBlocks(w, i, ni)) continue
				const pN = liquidPressureAt(w, nx, ny)
				let m = pressureMove(pSrc, pN, liq[i] * 0.5, LIQ_FULL - liq[ni])
				if (m <= 0.01)
					m = Math.min(liq[i] * 0.5, (liq[i] - liq[ni]) * 0.5, LIQ_FULL - liq[ni])
				if (m <= 0.01) continue
				applyTransfer(liq, flowX, flowY, i, ni, dx, 1, m)
				break
			}
		}

	// --- Horizontal: free-surface sheet / submerged orifice / edge vent / wind ---
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			if (liq[i] <= 0.05 || isLiquidBarrier(mat[i])) continue
			const pSrc = liquidPressureAt(w, x, y)
			const freeSurface = isFreeSurface(w, i, y)

			for (const dx of [-1, 1]) {
				const nx = x + dx
				if (nx < 0 || nx >= W) {
					const move = freeSurface
						? liq[i] * 0.25
						: Math.min(
							liq[i],
							Math.max(liq[i] * 0.2, Math.sqrt(Math.max(0, (pSrc - pressureAt(w, x, y)) / RHO_G)) * P_FLOW_GAIN),
						)
					liq[i] -= move
					flowX[i] += dx * move
					continue
				}
				const ni = i + dx
				if (isLiquidBarrier(mat[ni])) continue
				if (poolRetainBlocks(w, i, ni) && mat[ni] === MAT.AIR) continue
				if (sealedGasBlocks(w, ni, pSrc)) continue

				const pDst = liquidPressureAt(w, nx, y)
				const room = LIQ_FULL - liq[ni]
				let move = 0
				if (freeSurface && liq[ni] < LIQ_DRAW)
					move = sheetMove(liq[i], liq[ni], room)
				else {
					if (pDst >= pSrc - 0.02 && liq[ni] >= liq[i] - 0.02) continue
					move = pressureMove(pSrc, pDst, liq[i], room)
					if (move < 0.01 && liq[ni] < liq[i] - 0.02)
						move = Math.min((liq[i] - liq[ni]) * 0.25, room)
				}

				// Wind shear on free-surface sheets — gas ux pushes mass downwind.
				if (freeSurface && liq[i] >= LIQ_DRAW) {
					const { ux } = gasVelocityAt(w, x, y > 0 ? y - 1 : y)
					if (ux * dx > 0.15) {
						const wind = Math.min(WIND_SHEET_CAP, Math.abs(ux) * WIND_SHEET, liq[i] * 0.2, room)
						move = Math.max(move, wind)
					}
				}

				if (move > 0) applyTransfer(liq, flowX, flowY, i, ni, dx, 0, move)
			}
		}

	// --- Sealed gas pushes adjacent free liquid away (down preferred, else sideways) ---
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			const rid = w.regionId[i]
			if (!rid || liq[i] >= LIQ_DRAW) continue
			const region = w.regions[rid]
			if (!region || region.openToAtm || region.pressure <= P_ATM * 1.2) continue
			const gasP = region.pressure
			for (const [dx, dy] of ORTHO) {
				const nx = x + dx
				const ny = y + dy
				if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
				const ni = ny * W + nx
				if (liq[ni] < LIQ_DRAW || isLiquidBarrier(mat[ni])) continue
				const lP = liquidPressureAt(w, nx, ny)
				if (gasP <= lP + 0.08) continue
				const push = Math.min(0.2, liq[ni] * 0.35, (gasP - lP) * 0.15)
				if (push < 0.02) continue
				const tx = nx + dx
				const ty = ny + (dy === 0 ? 1 : dy)
				if (canOccupy(w, tx, ty) && liq[idx(w, tx, ty)] < LIQ_FULL) {
					const ti = idx(w, tx, ty)
					applyTransfer(liq, flowX, flowY, ni, ti, tx - nx, ty - ny, push)
				}
				else if (dy === 0 && ny + 1 < H && canOccupy(w, nx, ny + 1)) {
					const ti = idx(w, nx, ny + 1)
					applyTransfer(liq, flowX, flowY, ni, ti, 0, 1, push)
				}
			}
		}

	stepSoil(w)
	equalizeHydraulicAlongGraph(w, flowX, flowY)

	for (let x = 0; x < W; x++)
		liq[(H - 1) * W + x] = 0

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
