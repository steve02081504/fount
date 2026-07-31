/**
 * Shared pressure → mass transfer primitives.
 *
 * All free-liquid motion (gravity, orifice, sheet, gas push) goes through
 * Torricelli √(ΔP/ρg) or free-surface fill equalize. Hydraulic potential
 * φ = P/(ρg) − y is the communicating-vessel coordinate.
 */

import { RHO_G, LIQ_FULL } from './mat.mjs'

/** Max mass moved by a single pressure-driven edge transfer per tick. */
export const P_FLOW_CAP = 0.45
/** Scale: mass ∝ √(ΔP / RHO_G) — Torricelli orifice in cell-head units. */
export const P_FLOW_GAIN = 0.55
/** Free-surface sheet creep fraction of fill difference. */
export const SHEET_GAIN = 0.25

/**
 * Hydraulic potential φ = P/(ρg) − y (y↓ positive depth).
 * Equal φ ↔ equal free-surface height under the same air pressure.
 * @param {number} pressure absolute pressure
 * @param {number} y world row
 * @returns {number} potential
 */
export const hydraulicPhi = (pressure, y) => pressure / RHO_G - y

/**
 * Torricelli orifice mass for a pressure head (cell-head units).
 * @param {number} pSrc source pressure
 * @param {number} pDst destination pressure
 * @param {number} srcLiq available mass
 * @param {number} dstRoom free capacity at dest
 * @returns {number} move amount
 */
export const pressureMove = (pSrc, pDst, srcLiq, dstRoom) => {
	const head = (pSrc - pDst) / RHO_G
	if (head <= 0.02 || srcLiq <= 0 || dstRoom <= 0) return 0
	return Math.min(P_FLOW_CAP, srcLiq, dstRoom, Math.sqrt(head) * P_FLOW_GAIN)
}

/**
 * Free-surface sheet equalize — fill-level only, no pressurized jet.
 * @param {number} srcLiq source fill
 * @param {number} dstLiq dest fill
 * @param {number} dstRoom free capacity
 * @returns {number} move amount
 */
export const sheetMove = (srcLiq, dstLiq, dstRoom) => {
	if (srcLiq <= dstLiq + 0.02 || dstRoom <= 0) return 0
	return Math.min((srcLiq - dstLiq) * SHEET_GAIN, srcLiq, dstRoom)
}

/**
 * Apply a mass transfer src → dst and accumulate flow EMA contributions.
 * @param {Float32Array} liq liquid field
 * @param {Float32Array} flowX horizontal flow accumulator
 * @param {Float32Array} flowY vertical flow accumulator
 * @param {number} i source index
 * @param {number} ni dest index
 * @param {number} dx horizontal step
 * @param {number} dy vertical step
 * @param {number} move mass
 * @returns {number} mass actually moved
 */
export const applyTransfer = (liq, flowX, flowY, i, ni, dx, dy, move) => {
	if (move <= 0) return 0
	const m = Math.min(move, liq[i], LIQ_FULL - liq[ni])
	if (m <= 0) return 0
	liq[i] -= m
	liq[ni] += m
	flowX[i] += dx * m
	flowY[i] += dy * m
	flowX[ni] += dx * m
	flowY[ni] += dy * m
	return m
}
