/**
 * Deterministic hash + lattice noise shared by terrain and fluid.
 */

/** Cardinal neighbors as packed [dx, dy] pairs. */
export const ORTHO = /** @type {const} */ [[1, 0], [-1, 0], [0, 1], [0, -1]]
/** Flat cardinal dx (same order as `ORTHO`). */
export const ORTHO_DX = /** @type {const} */ [1, -1, 0, 0]
/** Flat cardinal dy (same order as `ORTHO`). */
export const ORTHO_DY = /** @type {const} */ [0, 0, 1, -1]

/**
 * Deterministic hash in [0, 1).
 * @param {number} a salt a
 * @param {number} [b=0] salt b
 * @returns {number} value in [0, 1)
 */
export const hash01 = (a, b = 0) => {
	let n = Math.imul(a ^ Math.imul(b, 1597334677), 3812015801)
	n ^= n >>> 13
	n = Math.imul(n, 1274126177)
	return ((n ^ n >>> 16) >>> 0) / 4294967296
}

/**
 * Smooth 1D value noise in [-1, 1].
 * @param {number} t continuous coordinate
 * @param {number} seed lattice salt
 * @returns {number} noise
 */
export const valueNoise1d = (t, seed) => {
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
export const fbm1d = (t, seed, octaves = 4) => {
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
 * Bilinear value noise in [0, 1).
 * @param {number} x column
 * @param {number} y row
 * @param {number} seed lattice salt
 * @returns {number} noise
 */
export const valueNoise2 = (x, y, seed) => {
	const x0 = Math.floor(x)
	const y0 = Math.floor(y)
	const fx = x - x0
	const fy = y - y0
	const v00 = hash01(x0 + seed, y0)
	const v10 = hash01(x0 + 1 + seed, y0)
	const v01 = hash01(x0 + seed, y0 + 1)
	const v11 = hash01(x0 + 1 + seed, y0 + 1)
	const a = v00 + (v10 - v00) * fx
	const b = v01 + (v11 - v01) * fx
	return a + (b - a) * fy
}

/**
 * 2D fBm via hash lattice, ~[0, 1).
 * @param {number} x column
 * @param {number} y row
 * @param {number} seed lattice salt
 * @returns {number} noise
 */
export const fbm2 = (x, y, seed) => {
	let amp = 0.5
	let freq = 1
	let sum = 0
	let norm = 0
	for (let o = 0; o < 4; o++) {
		sum += amp * valueNoise2(x * freq, y * freq, seed + o * 97)
		norm += amp
		amp *= 0.5
		freq *= 2
	}
	return sum / norm
}
