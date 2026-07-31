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
