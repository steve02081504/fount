/**
 * 地形与流体共用的确定性哈希与格点噪声。
 */

/** 正交邻居 dx：右、左、下、上。 */
export const ORTHO_DX = [1, -1, 0, 0]
/** 正交邻居 dy：与 ORTHO_DX 同序。 */
export const ORTHO_DY = [0, 0, 1, -1]

/** 对角邻居 dx：右下、左下、右上、左上。 */
export const DIAG_DX = [1, -1, 1, -1]
/** 对角邻居 dy：与 DIAG_DX 同序。 */
export const DIAG_DY = [1, 1, -1, -1]

/** 八邻 dx：正交在前，对角在后。 */
export const NEIGH8_DX = [1, -1, 0, 0, 1, -1, 1, -1]
/** 八邻 dy：与 NEIGH8_DX 同序。 */
export const NEIGH8_DY = [0, 0, 1, -1, 1, 1, -1, -1]

/**
 * 终端格高/宽比（字形格约 1×2）。
 * 物理深度与邻接单位向量用此度量；光照/涡旋半径同此。
 */
export const CELL_ASPECT = 2

/**
 * 格步 `(dx, dy)` 的物理长度（列宽 = 1，行高 = CELL_ASPECT）。
 * @param {number} dx 列步
 * @param {number} dy 行步
 * @returns {number} 物理长度
 */
export const cellStepLen = (dx, dy) => Math.hypot(dx, dy * CELL_ASPECT)

/**
 * 格步在物理平面上的单位方向（与设备 ĝ 同一视觉度量）。
 * @param {number} dx 列步
 * @param {number} dy 行步
 * @returns {{ ux: number, uy: number, len: number }} 单位向量与长度
 */
export const cellStepUnit = (dx, dy) => {
	const len = cellStepLen(dx, dy)
	return { ux: dx / len, uy: (dy * CELL_ASPECT) / len, len }
}

/**
 * [0, 1) 区间确定性哈希。
 * @param {number} a 盐值 a
 * @param {number} [b=0] 盐值 b
 * @returns {number} [0, 1) 内的值
 */
export const hash01 = (a, b = 0) => {
	let n = Math.imul(a ^ Math.imul(b, 1597334677), 3812015801)
	n ^= n >>> 13
	n = Math.imul(n, 1274126177)
	return ((n ^ n >>> 16) >>> 0) / 4294967296
}

/**
 * [-1, 1] 区间平滑一维值噪声。
 * @param {number} t 连续坐标
 * @param {number} seed 格点盐值
 * @returns {number} 噪声
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
 * 约 [-1, 1] 的偏粉一维 fBm。
 * @param {number} t 连续坐标
 * @param {number} seed 格点盐值
 * @param {number} [octaves=4] 倍频层数
 * @returns {number} 噪声
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
 * [0, 1) 区间双线性值噪声。
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} seed 格点盐值
 * @returns {number} 噪声
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
 * 哈希格点二维 fBm，约 [0, 1)。
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} seed 格点盐值
 * @returns {number} 噪声
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
