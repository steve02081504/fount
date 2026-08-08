/**
 * 地表行走、轮廓字符与土地几何刷新。
 */

import { hash01 } from '../hash.mjs'

/** 地表/墙体轮廓字符。 */
export const TERRAIN_CH = {
	FLAT: '_',
	FLAT_ALT: '-',
	SLOPE_UP: '/',   // 向右上升
	SLOPE_DOWN: '\\', // 向右下降
	WALL: '|',
	FLOOR: '-',
	CEIL: '-',
}

/** 须满足高地块厚度下限的可见陆地列（占视口宽度比例）。 */
export const TALL_LAND_FRACTION = 0.3
/** 高地块 = 列厚 ≥ 屏幕（视口）高度的该比例。 */
export const TALL_LAND_HEIGHT_FRAC = 0.25
/** 基座外侧两端强制与基座齐平的陆地列数。 */
const PEDESTAL_SHOULDER = 3

/**
 * 锚定图标基座的约束随机游走地表。
 * @param {number} W 世界宽
 * @param {{ baseY: number, minY: number, maxY: number, seed: number, footX0: number, footX1: number, viewH: number, viewW: number, ox: number, H: number }} opts 地表行走边界与视口锚点
 * @returns {Int16Array} 每列地表行
 */
export function buildSurface(W, {
	baseY, minY, maxY, seed,
	footX0, footX1, viewH, viewW, ox, H,
}) {
	const surface = new Int16Array(W)
	const x0 = Math.max(0, Math.min(W, footX0))
	const x1 = Math.max(x0, Math.min(W, footX1))

	for (let x = x0; x < x1; x++)
		surface[x] = baseY

	const shoulder = Math.min(PEDESTAL_SHOULDER, Math.max(1, (x1 - x0) >> 2))
	for (let i = 1; i <= shoulder; i++) {
		if (x0 - i >= 0) surface[x0 - i] = baseY
		if (x1 + i - 1 < W) surface[x1 + i - 1] = baseY
	}

	walkSurface(surface, x0 - shoulder - 1, -1, baseY, {
		minY, maxY, seed, hashOrigin: footX0,
	})
	walkSurface(surface, x1 + shoulder, 1, baseY, {
		minY, maxY, seed, hashOrigin: footX0,
	})

	softClampSpikes(surface, W)
	ensureTallLand(surface, {
		W, H, viewH, viewW, ox, seed, footX0: x0, footX1: x1, baseY,
	})
	for (let x = Math.max(0, x0 - shoulder); x < Math.min(W, x1 + shoulder); x++)
		surface[x] = baseY

	return surface
}

/**
 * 从锚点列沿 `dir`（±1）随机游走地表。
 * @param {Int16Array} surface 地表行（原地修改）
 * @param {number} startX 首写列
 * @param {number} dir +1 向右 / -1 向左
 * @param {number} startY 邻锚点高度
 * @param {{ minY: number, maxY: number, seed: number, hashOrigin?: number }} opts 行走边界与哈希原点
 * @returns {void}
 */
export function walkSurface(surface, startX, dir, startY, { minY, maxY, seed, hashOrigin = 0 }) {
	const W = surface.length
	if (startX < 0 || startX >= W) return

	let y = startY
	let slope = 0
	let plateau = 0
	for (let x = startX; dir > 0 ? x < W : x >= 0; x += dir) {
		const hx = x - hashOrigin
		const r = hash01(hx + seed, 3)
		const feature = hash01(hx + seed * 2, 19)

		if (plateau > 0)
			plateau--
		else if (feature > 0.92) {
			const drop = 2 + (hash01(hx, seed + 7) * 3 | 0)
			y += hash01(hx, seed + 8) > 0.5 ? drop : -drop
			slope = 0
			plateau = 1 + (hash01(hx, seed + 9) * 3 | 0)
		}
		else if (feature > 0.78) {
			slope = 0
			plateau = 3 + (hash01(hx, seed + 11) * 6 | 0)
		}
		else if (feature > 0.62)
			slope = Math.max(-2, Math.min(2, slope + (r > 0.5 ? 1 : -1)))
		else if (r < 0.25)
			slope = Math.max(-2, slope - 1)
		else if (r > 0.75)
			slope = Math.min(2, slope + 1)

		y += slope
		if (y < minY) {
			y = minY
			slope = Math.max(0, slope)
		}
		if (y > maxY) {
			y = maxY
			slope = Math.min(0, slope)
		}
		surface[x] = y
	}
}

/**
 * 单遍软钳位 3+ 孤立尖峰。
 * @param {Int16Array} surface 地表行（原地修改）
 * @param {number} W 世界宽
 * @returns {void}
 */
function softClampSpikes(surface, W) {
	for (let x = 1; x < W - 1; x++) {
		const dL = surface[x] - surface[x - 1]
		const dR = surface[x] - surface[x + 1]
		if (dL * dR > 0 && Math.abs(dL) >= 3 && Math.abs(dR) >= 3)
			surface[x] = Math.round((surface[x - 1] + surface[x + 1]) / 2)
	}
}

/**
 * 抬高足够视口列，使 ≥ TALL_LAND_FRACTION 列厚 ≥ ¼ 屏。
 * @param {Int16Array} surface 地表行（原地修改）
 * @param {{ W: number, H: number, viewH: number, viewW: number, ox: number, seed: number, footX0: number, footX1: number, baseY: number }} opts 视口与基座几何
 * @returns {void}
 */
function ensureTallLand(surface, {
	W, H, viewH, viewW, ox, seed, footX0, footX1, baseY,
}) {
	const minThick = Math.max(1, Math.ceil(viewH * TALL_LAND_HEIGHT_FRAC))
	const maxSurface = Math.max(2, Math.min(H - 2, viewH - minThick))
	const vx0 = Math.max(0, ox)
	const vx1 = Math.min(W, ox + viewW)
	const footContributes = viewH - baseY >= minThick
	const shoulderL = footX0 - PEDESTAL_SHOULDER
	const shoulderR = footX1 + PEDESTAL_SHOULDER

	/**
	 * @param {number} x 列
	 * @returns {boolean} 该列是否满足高地块厚度
	 */
	const isTall = (x) => x >= shoulderL && x < shoulderR
		? footContributes
		: viewH - surface[x] >= minThick

	let raisable = 0
	for (let x = vx0; x < vx1; x++)
		if (x < shoulderL || x >= shoulderR) raisable++
	const footSpan = Math.max(0, footX1 - footX0)
	const capacity = raisable + (footContributes ? footSpan + 2 * PEDESTAL_SHOULDER : 0)
	const need = Math.min(Math.ceil((vx1 - vx0) * TALL_LAND_FRACTION), capacity)

	let have = 0
	for (let x = vx0; x < vx1; x++)
		if (isTall(x)) have++
	if (have >= need) return

	const cands = []
	for (let x = vx0; x < vx1; x++) {
		if (x >= shoulderL && x < shoulderR) continue
		if (viewH - surface[x] >= minThick) continue
		cands.push(x)
	}
	cands.sort((a, b) => (viewH - surface[a]) - (viewH - surface[b]) ||
		hash01(a, seed + 3) - hash01(b, seed + 3))

	for (const x of cands) {
		if (have >= need) break
		const wasTall = isTall(x)
		surface[x] = Math.min(surface[x], maxSurface)
		if (!wasTall && isTall(x)) have++
		for (const dx of [-1, 1, -2, 2]) {
			const nx = x + dx
			if (nx < vx0 || nx >= vx1) continue
			if (nx >= shoulderL && nx < shoulderR) continue
			const neighborWas = isTall(nx)
			surface[nx] = Math.min(surface[nx], maxSurface + (Math.abs(dx) > 1 ? 1 : 0))
			if (!neighborWas && isTall(nx)) have++
		}
	}
}

/**
 * 由邻列差分选取地表列轮廓字符。
 * @param {Int16Array} surface 地表行
 * @param {number} W 世界宽
 * @returns {string[]} 每列地表字符
 */
export function buildSurfaceChars(surface, W) {
	const chars = Array(W)
	for (let x = 0; x < W; x++) {
		const y = surface[x]
		const left = x > 0 ? surface[x - 1] : y
		const right = x < W - 1 ? surface[x + 1] : y
		const dL = y - left
		const dR = right - y

		if (dL === 0 && dR === 0)
			chars[x] = (x + y) & 1 ? TERRAIN_CH.FLAT_ALT : TERRAIN_CH.FLAT
		else {
			const slope = dR || dL
			chars[x] = Math.abs(slope) >= 2
				? TERRAIN_CH.WALL
				: slope < 0 ? TERRAIN_CH.SLOPE_UP : TERRAIN_CH.SLOPE_DOWN
		}
	}
	return chars
}

/**
 * 预计算固体格轮廓字形（null = 内部/地表）。
 * @param {Uint8Array} solid 扁平固体掩码
 * @param {Int16Array} surface 地表行
 * @param {number} W 世界宽
 * @param {number} H 世界高
 * @returns {(string | null)[]} 扁平轮廓字形
 */
export function buildOutline(solid, surface, W, H) {
	const outline = Array(W * H)
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++)
			outline[y * W + x] = outlineChar(solid, x, y, W, H, surface)
	return outline
}

/**
 * 由土地占位 `solid`（即 `world.land`）重算地表行、地表字符与轮廓。
 * @param {import('./index.mjs').TerrainData} terrain 地形（原地更新）
 * @returns {void}
 */
export function refreshTerrainGeometry(terrain) {
	const { solid, worldW: W, worldH: H, surface } = terrain
	for (let x = 0; x < W; x++) {
		let top = H
		for (let y = 0; y < H; y++)
			if (solid[y * W + x]) {
				top = y
				break
			}
		surface[x] = top
	}
	terrain.surfaceChar = buildSurfaceChars(surface, W)
	terrain.outline = buildOutline(solid, surface, W, H)
}

/**
 * 固体格可见轮廓（邻空气）字符。
 * @param {Uint8Array} solid 扁平固体掩码
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} W 世界宽
 * @param {number} H 世界高
 * @param {Int16Array} surface 地表行
 * @returns {string | null} 轮廓字形或 null
 */
export function outlineChar(solid, x, y, W, H, surface) {
	const cell = y * W + x
	if (!solid[cell] || y === surface[x]) return null

	/**
	 * @param {number} nx 列
	 * @param {number} ny 行
	 * @returns {boolean} 空气 / 越界
	 */
	const air = (nx, ny) =>
		nx < 0 || ny < 0 || nx >= W || ny >= H || !solid[ny * W + nx]

	const up = air(x, y - 1)
	const down = air(x, y + 1)
	const left = air(x - 1, y)
	const right = air(x + 1, y)
	if (!(up || down || left || right)) return null

	if (left && right && !up && !down) return TERRAIN_CH.WALL
	if (up && down && !left && !right) return TERRAIN_CH.FLOOR
	if (up && right && !down && !left) return TERRAIN_CH.SLOPE_DOWN
	if (up && left && !down && !right) return TERRAIN_CH.SLOPE_UP
	if (down && right && !up && !left) return TERRAIN_CH.SLOPE_UP
	if (down && left && !up && !right) return TERRAIN_CH.SLOPE_DOWN
	if (left || right) return TERRAIN_CH.WALL
	if (up) return TERRAIN_CH.CEIL
	if (down) return TERRAIN_CH.FLOOR
	return TERRAIN_CH.WALL
}
