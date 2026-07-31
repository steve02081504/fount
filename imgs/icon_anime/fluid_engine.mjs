/**
 * Particle / grid-liquid / atmosphere engine for ASCII scenes.
 * Communicating vessels only through atmospheric air; sealed cavities do not equalize.
 */

/** @typedef {{ viewW: number, viewH: number, worldW: number, worldH: number, margin: number, ox: number, oy: number, mat: Uint8Array, liq: Float32Array, absorb: Float32Array, atmos: Uint8Array, particles: FluidParticle[], pendingSplash: FluidParticle[] }} FluidWorld */
/** @typedef {{ x: number, y: number, vx: number, vy: number, life: number }} FluidParticle */

/** 材质枚举。 */
export const MAT = {
	AIR: 0,
	SOLID: 1,
	SLOPE_L: 2, // <
	SLOPE_R: 3, // >
	HORIZON: 4, // ¯
	POOL: 5, // base @
	BODY: 6, // upper @
}

/**
 * 是否为不可穿透固体（含斜面与地平线）。
 * @param {number} m 材质
 * @returns {boolean} 是否固体
 */
export const isSolidMat = m =>
	m === MAT.SOLID || m === MAT.SLOPE_L || m === MAT.SLOPE_R || m === MAT.HORIZON

/**
 * 是否阻挡大气 flood-fill（固体 / 水池 / 图标液体）。
 * @param {number} m 材质
 * @returns {boolean} 是否阻挡
 */
export const isBlockMat = m => isSolidMat(m) || m === MAT.POOL || m === MAT.BODY

/**
 * 确定性 0..1 哈希。
 * @param {number} a 种子 a
 * @param {number} [b=0] 种子 b
 * @returns {number} [0,1) 值
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

/**
 * 创建流体世界（视口外带 margin，供洞穴越过显示边缘完整生成）。
 * @param {{ width: number, height: number, margin?: number, bottomExtra?: number }} [opts] 视口与边界
 * @returns {FluidWorld} 世界状态
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
		atmos: new Uint8Array(size),
		particles: /** @type {FluidParticle[]} */ [],
		pendingSplash: /** @type {FluidParticle[]} */ [],
	}
}

/**
 * 世界坐标 → 线性下标。
 * @param {FluidWorld} w 世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {number} 下标
 */
export const idx = (w, x, y) => y * w.worldW + x

/**
 * 坐标是否在逻辑世界内。
 * @param {FluidWorld} w 世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {boolean} 是否在界内
 */
export const inWorld = (w, x, y) =>
	x >= 0 && y >= 0 && x < w.worldW && y < w.worldH

/**
 * 清空液体与粒子。
 * @param {FluidWorld} w 世界
 * @returns {void}
 */
export const clearDynamics = (w) => {
	w.liq.fill(0)
	w.particles.length = 0
	w.pendingSplash.length = 0
}

/**
 * 清空材质与地平线吸收配额。
 * @param {FluidWorld} w 世界
 * @returns {void}
 */
export const clearMaterials = (w) => {
	w.mat.fill(MAT.AIR)
	w.absorb.fill(0)
}

/**
 * 写入材质；地平线可带吸收配额。
 * @param {FluidWorld} w 世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} m 材质
 * @param {number} [absorb=0] 地平线剩余吸收量
 * @returns {void}
 */
export const setMat = (w, x, y, m, absorb = 0) => {
	if (!inWorld(w, x, y)) return
	const i = idx(w, x, y)
	w.mat[i] = m
	if (m === MAT.HORIZON) w.absorb[i] = absorb
}

/**
 * 向格内加入液体量（固体格忽略）。
 * @param {FluidWorld} w 世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} amt 增量
 * @returns {number} 实际加入量
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
 * 生成雨滴/飞行粒子。
 * @param {FluidWorld} w 世界
 * @param {number} x x
 * @param {number} y y
 * @param {number} vx 水平速度
 * @param {number} vy 竖直速度
 * @param {number} [life=40] 寿命帧数
 * @returns {void}
 */
export const spawnParticle = (w, x, y, vx, vy, life = 40) => {
	if (w.particles.length > 1200) return
	w.particles.push({ x, y, vx, vy, life })
}

/**
 * 排队溅射粒子（下一次 stepParticles 起生效）。
 * @param {FluidWorld} w 世界
 * @param {number} x x
 * @param {number} y y
 * @param {number} vx 水平速度
 * @param {number} vy 竖直速度
 * @param {number} [life=18] 寿命帧数
 * @returns {void}
 */
export const queueSplash = (w, x, y, vx, vy, life = 18) => {
	w.pendingSplash.push({ x, y, vx, vy, life })
}

/**
 * 从顶边与左右开边界 flood-fill，标记大气连通气胞。
 * @param {FluidWorld} w 世界
 * @returns {void}
 */
export const markAtmosphere = (w) => {
	const { worldW: W, worldH: H, mat, liq, atmos } = w
	atmos.fill(0)
	const q = []
	/**
	 * 尝试将气胞标为大气。
	 * @param {number} x 列
	 * @param {number} y 行
	 * @returns {void}
	 */
	const push = (x, y) => {
		if (x < 0 || y < 0 || x >= W || y >= H) return
		const i = y * W + x
		if (atmos[i]) return
		if (isBlockMat(mat[i])) return
		if (liq[i] >= LIQ_DRAW) return
		atmos[i] = 1
		q.push(x, y)
	}
	for (let x = 0; x < W; x++) push(x, 0)
	for (let y = 1; y < H; y++) {
		push(0, y)
		push(W - 1, y)
	}
	for (let qi = 0; qi < q.length; qi += 2) {
		const x = q[qi]
		const y = q[qi + 1]
		push(x - 1, y)
		push(x + 1, y)
		push(x, y - 1)
		push(x, y + 1)
	}
}

/**
 * 液体是否可占据该格。
 * @param {FluidWorld} w 世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {boolean} 可否占据
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
 * 液体步进：重力、侧向流、连通器均压（仅大气连通面）；封闭气腔不均压。
 * @param {FluidWorld} w 世界
 * @returns {void}
 */
export const stepLiquid = (w) => {
	const { worldW: W, worldH: H, mat, liq, atmos } = w
	markAtmosphere(w)

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
				const move = Math.min(liq[i], LIQ_FULL - liq[below])
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
				// sealed cavity: no cross-cavity flow unless already wet
				if (!(atmos[ni] || atmos[i] || liq[ni] > 0.05)) continue
				if (liq[ni] >= liq[i] - 0.02) continue
				const move = Math.min((liq[i] - liq[ni]) * 0.25, LIQ_FULL - liq[ni])
				liq[i] -= move
				liq[ni] += move
			}
		}

	// communicating vessels via atmospheric surfaces only
	const colTop = new Int16Array(W)
	colTop.fill(-1)
	for (let x = 0; x < W; x++)
		for (let y = 0; y < H; y++) {
			const i = y * W + x
			if (liq[i] > LIQ_DRAW && !isSolidMat(mat[i])) {
				colTop[x] = y
				break
			}
		}

	for (let x = 0; x < W - 1; x++) {
		if (colTop[x] < 0 || colTop[x + 1] < 0) continue
		const y0 = colTop[x]
		const y1 = colTop[x + 1]
		const above0 = y0 > 0 ? (y0 - 1) * W + x : -1
		const above1 = y1 > 0 ? (y1 - 1) * W + (x + 1) : -1
		if (above0 >= 0 && !atmos[above0] && liq[above0] < LIQ_DRAW) continue
		if (above1 >= 0 && !atmos[above1] && liq[above1] < LIQ_DRAW) continue
		if (Math.abs(y0 - y1) < 1) continue
		const high = y0 < y1 ? x : x + 1
		const low = y0 < y1 ? x + 1 : x
		const from = colTop[high] * W + high
		const destY = Math.min(H - 1, Math.max(colTop[low], colTop[high]) + 1)
		const di = destY * W + low
		if (liq[from] > 0.1 && !isSolidMat(mat[di]) && liq[di] < LIQ_FULL) {
			const move = Math.min(0.15, liq[from], LIQ_FULL - liq[di])
			liq[from] -= move
			liq[di] += move
		}
	}

	for (let x = 0; x < W; x++)
		liq[(H - 1) * W + x] = 0
}

/**
 * 积分粒子；碰撞时调用 onHit（可 queueSplash / addLiquid）。
 * @param {FluidWorld} w 世界
 * @param {(w: FluidWorld, x: number, y: number, m: number, p: FluidParticle, wet: boolean) => void} onHit 碰撞回调
 * @returns {void}
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
 * 雨滴字形（按亚像素相位）。
 * @param {number} yf 浮点 y
 * @param {boolean} fast 高速时用 |
 * @returns {string} 字符
 */
export const rainChar = (yf, fast) => {
	if (fast) return '|'
	const u = ((yf % 1) + 1) % 1
	if (u < 0.35) return '\''
	if (u < 0.7) return '.'
	return ','
}

/** 自由液体绘制阈值。 */
export const LIQUID_DRAW_THRESHOLD = LIQ_DRAW
