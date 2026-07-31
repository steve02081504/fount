/**
 * Water / drip glyph sets driven by amount × liquid velocity (not gas wind).
 */

import { COND_DRAW, COND_DRIP } from './mat.mjs'

/** Falling / stream amount at which vertical glyphs prefer dense bars. */
export const FALL_HEAVY = 0.5
/** Speed below this → still-water glyphs. */
export const STILL_SPEED = 0.06
/** |vx| above this (vs vertical) counts as horizontal/slant motion. */
export const SLANT_SPEED = 0.08
/** |vx| dominates |vy| → flat `-`. */
export const FLAT_RATIO = 1.2
/** Momentum (amount·speed) at/above this uses high-momentum slant glyphs. */
export const HIGH_MOMENTUM = 0.28
/** Absolute speed at/above this also counts as high momentum. */
export const HIGH_SPEED = 0.55

/** High-momentum left slant. */
export const WATER_HIGH_L = Object.freeze(['/', '∕'])
/** High-momentum right slant. */
export const WATER_HIGH_R = Object.freeze(['\\', '∖'])
/** Low-momentum toward lower-left. */
export const WATER_LOW_DL = Object.freeze(['‚', '´', '′', '‘', '’', '″', '“', '„', '‴', '⁗'])
/** Low-momentum toward lower-right. */
export const WATER_LOW_DR = Object.freeze(['‵', '‛', '‶', '‟', '‷', '⁏'])
/** Pure vertical fall (heavy → light). */
export const WATER_FALL = Object.freeze(['|', '¦', '‖', '⁞', '⁚', '⁝', '.'])
/** Near-still pool (light → heavy). */
export const WATER_STILL = Object.freeze(['‥', '…', '~', '⁓', '–'])

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
	const t = heavyFirst ? 1 - Math.min(0.999, Math.max(0, amount)) : Math.min(0.999, Math.max(0, amount))
	let i = (t * n) | 0
	if ((phase | 0) & 1) i = Math.min(n - 1, i + 1)
	return chars[i]
}

/**
 * Water glyph from amount + liquid/particle velocity (not gas wind).
 * @param {number} amount water mass
 * @param {number} [phase=0] flicker seed
 * @param {number} [vx=0] horizontal velocity
 * @param {number} [vy=0] vertical velocity (down +)
 * @returns {string} glyph
 */
export const waterChar = (amount, phase = 0, vx = 0, vy = 0) => {
	const ax = Math.abs(vx)
	const ay = Math.abs(vy)
	const speed2 = vx * vx + vy * vy
	const still2 = STILL_SPEED * STILL_SPEED

	if (speed2 < still2)
		return pickWaterGlyph(WATER_STILL, amount, phase)

	const speed = Math.sqrt(speed2)
	if (ax >= SLANT_SPEED && ax > ay * FLAT_RATIO) return '-'

	const slant = ax >= SLANT_SPEED
	const high = amount * speed >= HIGH_MOMENTUM || speed >= HIGH_SPEED

	if (slant) {
		if (high)
			return pickWaterGlyph(vx > 0 ? WATER_HIGH_R : WATER_HIGH_L, amount, phase, true)
		return pickWaterGlyph(vx > 0 ? WATER_LOW_DR : WATER_LOW_DL, amount, phase, true)
	}

	const fallAmt = amount >= FALL_HEAVY ? 1 : amount / FALL_HEAVY * 0.4
	return pickWaterGlyph(WATER_FALL, fallAmt, phase, true)
}

/**
 * Free-liquid glyph; optional `falling` biases a calm cell downward.
 * @param {number} amount water mass
 * @param {number} phase flicker seed
 * @param {boolean} [falling=false] no support below
 * @param {number} [vx=0] horizontal velocity
 * @param {number} [vy=0] vertical velocity
 * @returns {string} glyph
 */
export const liquidChar = (amount, phase, falling = false, vx = 0, vy = 0) => {
	if (falling && Math.hypot(vx, vy) < STILL_SPEED) vy = 0.55
	return waterChar(amount, phase, vx, vy)
}

/**
 * Hanging droplet under a soil ceiling, by condensation amount.
 * @param {number} amount condensation mass
 * @param {number} phase flicker seed
 * @returns {string} glyph
 */
export const dripChar = (amount, phase) => {
	if (amount >= COND_DRIP) return 'o'
	if (amount >= 0.6) return phase & 1 ? 'o' : '*'
	if (amount >= COND_DRAW) return phase & 1 ? ',' : '.'
	return ' '
}
