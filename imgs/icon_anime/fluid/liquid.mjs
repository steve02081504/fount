/**
 * Grid liquid: gravity, side flow, soil seepage, hydraulic equalization.
 */

import { hash01 } from '../hash.mjs'

import { labelAirRegions, pressureAt } from './gas.mjs'
import {
	MAT, P_ATM, RHO_G, LIQ_DRAW, LIQ_FULL, SOIL_CAP,
	SOIL_ABSORB_RATE, SOIL_SIDE_FRAC, SOIL_DOWN_FRAC, SOIL_CONDENSE_FRAC,
	COND_DRIP, COND_MATTHEW_RATE, COND_MATTHEW_NOISE,
	isSoilMat, isLiquidBarrier, soilAbsorbFactor,
} from './mat.mjs'
import { scratch, growScratch, idx, addLiquid } from './world.mjs'

/** @typedef {import('./world.mjs').FluidWorld} FluidWorld */

const ORTHO = Object.freeze([[1, 0], [-1, 0], [0, 1], [0, -1]])

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
 * Label connected liquid components; return free-surface samples.
 * @param {FluidWorld} w world
 * @returns {{ surfaces: { x: number, y: number, component: number, pressure: number }[], componentOf: Int32Array }} surfaces
 */
export const labelLiquidSurfaces = (w) => {
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
					surfaces.push({ x: cx, y: cy, component: id, pressure: P_ATM })
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
 * Equalize hydraulic potential across free surfaces of the same liquid component.
 * @param {FluidWorld} w world
 * @returns {void}
 */
const equalizeHydraulic = (w) => {
	const { surfaces } = labelLiquidSurfaces(w)
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
 * Liquid step: gravity, side flow, soil seepage, hydraulic equalization.
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

	for (let y = H - 2; y >= 0; y--)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			if (liq[i] <= 0) continue
			if (isLiquidBarrier(mat[i])) {
				liq[i] = 0
				continue
			}
			const below = i + W
			if (!isLiquidBarrier(mat[below]) && liq[below] < LIQ_FULL) {
				const retain = mat[i] === MAT.POOL
				const intoPool = mat[below] === MAT.POOL
				if (!(retain && !intoPool && liq[i] < 0.92)) {
					const resist = Math.max(0, (pressureAt(w, x, y + 1) - P_ATM) * 0.35)
					const move = Math.min(liq[i], Math.max(0, LIQ_FULL - liq[below] - resist))
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
				if (mat[i] === MAT.POOL && mat[ni] !== MAT.POOL && liq[i] < 0.92) continue
				const move = Math.min(liq[i] * 0.5, (liq[i] - liq[ni]) * 0.5, LIQ_FULL - liq[ni])
				if (move <= 0.01) continue
				liq[i] -= move
				liq[ni] += move
				noteFlow(i, ni, dx, 1, move)
				break
			}
		}

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			if (liq[i] <= 0.05 || isLiquidBarrier(mat[i])) continue
			for (const dx of [-1, 1]) {
				const nx = x + dx
				if (nx < 0 || nx >= W) {
					const move = liq[i] * 0.25
					liq[i] -= move
					flowX[i] += dx * move
					continue
				}
				const ni = i + dx
				if (isLiquidBarrier(mat[ni])) continue
				if (mat[i] === MAT.POOL && mat[ni] === MAT.AIR && liq[i] < 0.92) continue
				const rid = w.regionId[ni]
				if (liq[ni] <= 0.05 && rid) {
					const r = w.regions.get(rid)
					if (r && !r.openToAtm && r.pressure > P_ATM * 1.15) continue
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
	labelAirRegions(w)

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
