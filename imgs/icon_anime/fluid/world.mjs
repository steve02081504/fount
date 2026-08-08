/**
 * 流体世界网格：材质、液体、熔岩、温度、土壤水、气体速度、粒子、重力。
 */

import { defaultGravity } from '../gravity.mjs'
import { NEIGH8_DX, NEIGH8_DY, NEIGH8_UX, NEIGH8_UY, ORTHO_DX, ORTHO_DY } from '../hash.mjs'

import { MAT, SOIL_CAP, LIQ_FULL, LIQ_DRAW, isSoilMat, isLiquidBarrier } from './mat.mjs'
import { createParticlePool, clearParticlePool, totalParticleWater } from './particle_pool.mjs'

/** @typedef {import('../gravity.mjs').GravityState} GravityState */

/** @typedef {{
 *   viewW: number, viewH: number, worldW: number, worldH: number,
 *   margin: number, ox: number, oy: number,
 *   mat: Uint8Array, land: Uint8Array,
 *   liq: Float32Array, melt: Float32Array, temp: Float32Array,
 *   moisture: Float32Array, condense: Float32Array,
 *   gasUx: Float32Array, gasUy: Float32Array,
 *   liqVx: Float32Array, liqVy: Float32Array,
 *   meltVx: Float32Array, meltVy: Float32Array,
 *   regionId: Int32Array,
 *   regions: (import('./gas.mjs').AirRegion | undefined)[],
 *   particles: import('./particle_pool.mjs').ParticlePool,
 *   pendingSplash: import('./particle_pool.mjs').ParticlePool,
 *   soilStep: number, gasTime: number,
 *   airDirty: boolean,
 *   gasGeomDirty: boolean,
 *   soilGeomDirty: boolean,
 *   maxUpdraft: number,
 *   gravity: GravityState,
 *   gravityDepth0: number,
 *   gravityDepthSpan: number,
 *   boundary: {
 *     absorbedUnits: number, absorbedHeat: number,
 *     regurgitating: boolean, regurgitatedUnits: number, regurgitatedHeat: number,
 *     regurgitatePhase: number,
 *     exposure: Float32Array,
 *     absorbGx: number, absorbGy: number,
 *   },
 *   scratch: Record<string, unknown>,
 *   floodQ: Int32Array,
 *   floodLen: number,
 * }} FluidWorld
 */

/** 重力方向点积变化超过此值时标脏空气几何。 */
const GRAVITY_DIRTY_DOT = 0.92

/** 复用的加权邻格缓冲（向下，正交）。 */
const DOWN_W = {
	dx: [0, 0, 0, 0, 0, 0, 0, 0],
	dy: [0, 0, 0, 0, 0, 0, 0, 0],
	w: [0, 0, 0, 0, 0, 0, 0, 0],
	n: 0,
}
/** 复用的加权邻格缓冲（向上，正交）。 */
const UP_W = {
	dx: [0, 0, 0, 0, 0, 0, 0, 0],
	dy: [0, 0, 0, 0, 0, 0, 0, 0],
	w: [0, 0, 0, 0, 0, 0, 0, 0],
	n: 0,
}
/** 沉降用下向（可含对角）。 */
const SETTLE_DOWN_W = {
	dx: [0, 0, 0, 0, 0, 0, 0, 0],
	dy: [0, 0, 0, 0, 0, 0, 0, 0],
	w: [0, 0, 0, 0, 0, 0, 0, 0],
	n: 0,
}
/** 复用的侧向（⊥ĝ）加权正交邻格。 */
const SIDE_W = { dx: [0, 0, 0, 0], dy: [0, 0, 0, 0], w: [0, 0, 0, 0], n: 0 }

/** |gx|、|gy| 均超过此值时启用对角邻接（避免纯轴向下虚假斜流）。 */
const DIAG_TILT_MIN = 0.28

/**
 * 用当前重力填充下/上向加权邻格缓冲。
 * 权重 = 物理单位步向 · ĝ（预计算 `NEIGH8_UX/UY`）；可选对角。
 * @param {FluidWorld} world 世界
 * @param {{ dx: number[], dy: number[], w: number[], n: number }} out 输出
 * @param {number} sense +1 向下，-1 向上
 * @param {boolean} [diagonals=false] 是否在倾斜时加入对角
 * @returns {{ dx: number[], dy: number[], w: number[], n: number }} out
 */
const fillGravityWeights = (world, out, sense, diagonals = false) => {
	const gx = world.gravity.gx * sense
	const gy = world.gravity.gy * sense
	const tilted = diagonals
		&& gx * gx > DIAG_TILT_MIN * DIAG_TILT_MIN
		&& gy * gy > DIAG_TILT_MIN * DIAG_TILT_MIN
	out.n = 0
	const nCand = tilted ? 8 : 4
	for (let c = 0; c < nCand; c++) {
		const dot = NEIGH8_UX[c] * gx + NEIGH8_UY[c] * gy
		if (dot <= 1e-6) continue
		const i = out.n++
		out.dx[i] = NEIGH8_DX[c]
		out.dy[i] = NEIGH8_DY[c]
		out.w[i] = dot
	}
	return out
}

/**
 * 预算投影深度原点与跨度（四角最小值 → depth0，使深度非负）。
 * 深度在格点步长空间（与 RHO_G / ATM_HYDRO 标定一致）；视觉纵横比只进邻接 û。
 * @param {FluidWorld} world 世界
 * @returns {void}
 */
const recomputeGravityDepthBasis = (world) => {
	const { gx, gy } = world.gravity
	const W = world.worldW
	const H = world.worldH
	const d0 = 0
	const d1 = (W - 1) * gx
	const d2 = (H - 1) * gy
	const d3 = d1 + d2
	world.gravityDepth0 = Math.min(d0, d1, d2, d3)
	world.gravityDepthSpan = Math.max(1e-6, Math.max(d0, d1, d2, d3) - world.gravityDepth0)
}

/**
 * 分配边界状态块。
 * @returns {FluidWorld['boundary']} 边界
 */
const createBoundary = () => ({
	absorbedUnits: 0,
	absorbedHeat: 0,
	regurgitating: false,
	regurgitatedUnits: 0,
	regurgitatedHeat: 0,
	regurgitatePhase: 0,
	exposure: new Float32Array(4),
	absorbGx: 0,
	absorbGy: 1,
})

/**
 * 重置边界动力学（保留 exposure 缓冲）。
 * @param {FluidWorld['boundary']} boundary 边界
 * @returns {void}
 */
const resetBoundary = (boundary) => {
	boundary.absorbedUnits = 0
	boundary.absorbedHeat = 0
	boundary.regurgitating = false
	boundary.regurgitatedUnits = 0
	boundary.regurgitatedHeat = 0
	boundary.regurgitatePhase = 0
	boundary.exposure.fill(0)
	boundary.absorbGx = 0
	boundary.absorbGy = 1
}

/**
 * 为视口矩形加边距分配流体世界。
 * @param {{ width: number, height: number, margin?: number, bottomExtra?: number }} [opts] 视口尺寸
 * @returns {FluidWorld} 空世界
 */
export const createWorld = ({ width, height, margin = 24, bottomExtra = 4 } = {}) => {
	const worldW = width + margin * 2
	const worldH = height + bottomExtra
	const size = worldW * worldH
	/** @type {FluidWorld} */
	const world = {
		viewW: width, viewH: height, worldW, worldH, margin, ox: margin, oy: 0,
		mat: new Uint8Array(size),
		land: new Uint8Array(size),
		liq: new Float32Array(size),
		melt: new Float32Array(size),
		temp: new Float32Array(size),
		moisture: new Float32Array(size),
		condense: new Float32Array(size),
		gasUx: new Float32Array(size),
		gasUy: new Float32Array(size),
		liqVx: new Float32Array(size),
		liqVy: new Float32Array(size),
		meltVx: new Float32Array(size),
		meltVy: new Float32Array(size),
		regionId: new Int32Array(size),
		regions: [],
		particles: createParticlePool(),
		pendingSplash: createParticlePool(),
		soilStep: 0,
		gasTime: 0,
		airDirty: true,
		gasGeomDirty: true,
		soilGeomDirty: false,
		maxUpdraft: NaN,
		gravity: defaultGravity(),
		gravityDepth0: 0,
		gravityDepthSpan: Math.max(worldW, worldH),
		boundary: createBoundary(),
		scratch: {},
		floodQ: new Int32Array(256),
		floodLen: 0,
	}
	recomputeGravityDepthBasis(world)
	return world
}

/**
 * 确保长度为 `n` 的类型化 scratch 缓冲。
 * @param {FluidWorld} world 流体世界
 * @param {string} key scratch 槽位
 * @param {number} n 长度
 * @param {typeof Float32Array | typeof Uint8Array | typeof Uint16Array | typeof Int32Array} Ctor 类型化数组构造器
 * @returns {Float32Array | Uint8Array | Uint16Array | Int32Array} 缓冲
 */
export const scratch = (world, key, n, Ctor) => {
	let buf = world.scratch[key]
	if (!buf || buf.length !== n) {
		buf = new Ctor(n)
		world.scratch[key] = buf
	}
	return buf
}

/**
 * 将类型化 scratch 缓冲扩容至至少 `need` 个元素（翻倍）。
 * @param {FluidWorld} world 流体世界
 * @param {string} key scratch 槽位
 * @param {number} need 最小长度
 * @param {typeof Float32Array | typeof Int32Array} Ctor 类型化数组构造器
 * @returns {Float32Array | Int32Array} 缓冲
 */
export const growScratch = (world, key, need, Ctor) => {
	const buf = world.scratch[key]
	if (!buf || buf.length < need) {
		const next = new Ctor(Math.max(need, buf ? buf.length * 2 : 256))
		if (buf) next.set(buf)
		world.scratch[key] = next
		return next
	}
	return buf
}

/**
 * 清空 BFS 泛洪队列（保留容量）。
 * @param {FluidWorld} world 世界
 * @returns {void}
 */
export const floodClear = (world) => {
	world.floodLen = 0
}

/**
 * 将 `(x, y)` 压入泛洪队列。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {void}
 */
export const floodPush = (world, x, y) => {
	let q = world.floodQ
	const len = world.floodLen
	if (len + 2 > q.length) {
		const next = new Int32Array(Math.max(len + 2, q.length * 2))
		next.set(q)
		world.floodQ = q = next
	}
	q[len] = x
	q[len + 1] = y
	world.floodLen = len + 2
}

/**
 * 世界格 `(x, y)` 的扁平索引。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {number} 索引
 */
export const idx = (world, x, y) => y * world.worldW + x

/**
 * `(x, y)` 是否在世界网格内。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {boolean} 在界内
 */
export const inWorld = (world, x, y) =>
	x >= 0 && y >= 0 && x < world.worldW && y < world.worldH

/**
 * 清空液体、熔岩、温度、湿度、气体、粒子与区域标签。
 * @param {FluidWorld} world 世界
 * @returns {void}
 */
export const clearDynamics = (world) => {
	world.liq.fill(0)
	world.melt.fill(0)
	world.temp.fill(0)
	world.moisture.fill(0)
	world.condense.fill(0)
	world.gasUx.fill(0)
	world.gasUy.fill(0)
	world.liqVx.fill(0)
	world.liqVy.fill(0)
	world.meltVx.fill(0)
	world.meltVy.fill(0)
	clearParticlePool(world.particles)
	clearParticlePool(world.pendingSplash)
	world.regionId.fill(0)
	world.regions.length = 0
	world.gasTime = 0
	world.airDirty = true
	world.gasGeomDirty = true
	world.maxUpdraft = NaN
	resetBoundary(world.boundary)
}

/**
 * 仅清空材质标签——湿度/凝结/温度在重建间保留。
 * @param {FluidWorld} world 世界
 * @returns {void}
 */
export const clearMaterials = (world) => {
	world.mat.fill(MAT.AIR)
	world.airDirty = true
	world.gasGeomDirty = true
}

/**
 * 游离液体绘制占用可能翻转时标记空气/气体几何脏。
 * @param {FluidWorld} world 世界
 * @param {number} before 变更前量
 * @param {number} after 变更后量
 * @returns {void}
 */
export const markAirIfDrawCrossed = (world, before, after) => {
	if ((before >= LIQ_DRAW) === (after >= LIQ_DRAW)) return
	world.airDirty = true
	world.gasGeomDirty = true
}

/**
 * 熔岩绘制占用翻转时同样标脏。
 * @param {FluidWorld} world 世界
 * @param {number} before 变更前
 * @param {number} after 变更后
 * @returns {void}
 */
export const markAirIfMeltDrawCrossed = (world, before, after) => {
	if ((before >= LIQ_DRAW) === (after >= LIQ_DRAW)) return
	world.airDirty = true
	world.gasGeomDirty = true
}

/**
 * 将非土壤格的湿度/凝结泄入游离液体（或上方格）。
 * @param {FluidWorld} world 世界
 * @returns {void}
 */
export const releaseNonSoilWater = (world) => {
	const { worldW: W, worldH: H, mat, liq, moisture, condense } = world
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x
			if (isSoilMat(mat[i])) continue
			const held = moisture[i] + condense[i]
			moisture[i] = 0
			condense[i] = 0
			if (held <= 0) continue
			if (mat[i] === MAT.POOL || mat[i] === MAT.AIR) {
				const before = liq[i]
				liq[i] = Math.min(LIQ_FULL, before + held)
				markAirIfDrawCrossed(world, before, liq[i])
				continue
			}
			if (y > 0 && !isLiquidBarrier(mat[(y - 1) * W + x])) {
				const ai = (y - 1) * W + x
				const before = liq[ai]
				liq[ai] = Math.min(LIQ_FULL, before + held)
				markAirIfDrawCrossed(world, before, liq[ai])
			}
		}
}

/**
 * 设置 `(x, y)` 处材质（调用方保证在界内）。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} m 材质 id
 * @returns {void}
 */
export const setMat = (world, x, y, m) => {
	const i = y * world.worldW + x
	if (world.mat[i] === m) return
	world.mat[i] = m
	world.airDirty = true
	world.gasGeomDirty = true
}

/**
 * 向土壤格添加湿度（钳制）。返回实际存入量。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} amt 待添加量
 * @returns {number} 存入增量
 */
export const addMoisture = (world, x, y, amt) => {
	if (amt <= 0) return 0
	const i = y * world.worldW + x
	if (!isSoilMat(world.mat[i])) return 0
	const before = world.moisture[i]
	world.moisture[i] = Math.min(SOIL_CAP, before + amt)
	return world.moisture[i] - before
}

/**
 * 网格水总量：游离液体 + 土壤湿度 + 悬挂凝结。
 * @param {FluidWorld} world 世界
 * @returns {number} 总质量
 */
export const totalGridWater = (world) => {
	let t = 0
	for (let i = 0; i < world.liq.length; i++)
		t += world.liq[i] + world.moisture[i] + world.condense[i]
	return t
}

/**
 * 世界水总量：网格蓄水池 + 活跃/待处理粒子。
 * @param {FluidWorld} world 世界
 * @returns {number} 总质量
 */
export const totalWorldWater = (world) =>
	totalGridWater(world)
	+ totalParticleWater(world.particles)
	+ totalParticleWater(world.pendingSplash)

/**
 * 网格熔岩总量。
 * @param {FluidWorld} world 世界
 * @returns {number} 总量
 */
export const totalMelt = (world) => {
	let t = 0
	for (let i = 0; i < world.melt.length; i++) t += world.melt[i]
	return t
}

/**
 * 在 `(x, y)` 添加游离液体，除非该格为液体屏障或已被熔岩占据。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} amt 待添加量
 * @returns {number} 存入增量
 */
export const addLiquid = (world, x, y, amt) => {
	const i = y * world.worldW + x
	if (isLiquidBarrier(world.mat[i])) return 0
	if (world.melt[i] >= LIQ_DRAW) return 0
	const before = world.liq[i]
	world.liq[i] = Math.min(LIQ_FULL, before + amt)
	const stored = world.liq[i] - before
	if (stored > 0) markAirIfDrawCrossed(world, before, world.liq[i])
	return stored
}

/**
 * 在 `(x, y)` 添加熔岩并设置温度（质量加权）。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} amt 质量
 * @param {number} temp 温度
 * @returns {number} 存入增量
 */
export const addMelt = (world, x, y, amt, temp) => {
	if (amt <= 0) return 0
	const i = y * world.worldW + x
	const m = world.mat[i]
	if (m !== MAT.AIR && m !== MAT.SOLID && m !== MAT.HORIZON) return 0

	const before = world.melt[i]
	const room = LIQ_FULL - before
	const take = Math.min(amt, room)
	if (take <= 0) return 0
	const heat = world.temp[i] * before + temp * take
	world.melt[i] = before + take
	world.temp[i] = heat / world.melt[i]
	// Melt displaces free water (flash handled in thermal).
	if (world.liq[i] > 0) {
		const wBefore = world.liq[i]
		world.liq[i] = 0
		markAirIfDrawCrossed(world, wBefore, 0)
	}
	if (world.mat[i] === MAT.SOLID || world.mat[i] === MAT.HORIZON) {
		world.mat[i] = MAT.AIR
		if (world.land[i]) {
			world.land[i] = 0
			world.soilGeomDirty = true
		}
	}
	markAirIfMeltDrawCrossed(world, before, world.melt[i])
	return take
}

/**
 * 重力投影深度（沿 ĝ 增大；默认 ĝ=(0,1) 时等于 y）。
 * 格点步长空间 — 静水 / Torricelli 标定；视觉 CELL_ASPECT 只影响邻接 û 与渲染半径。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {number} 深度标量
 */
export const gravityDepth = (world, x, y) =>
	x * world.gravity.gx + y * world.gravity.gy - world.gravityDepth0

/**
 * 填充每格重力深度 scratch（同行共享 `y·gy − depth0`）。
 * @param {FluidWorld} world 世界
 * @returns {Float32Array} 长度 WH 的深度场
 */
export const fillCellDepths = (world) => {
	const { worldW: W, worldH: H, gravity: { gx, gy }, gravityDepth0 } = world
	const n = W * H
	const depth = scratch(world, 'cellDepth', n, Float32Array)
	for (let y = 0; y < H; y++) {
		const row = y * W
		const base = y * gy - gravityDepth0
		for (let x = 0; x < W; x++)
			depth[row + x] = x * gx + base
	}
	return depth
}

/**
 * 按投影深度 counting-sort 填满网格序（浅→深或深→浅）。
 * @param {FluidWorld} world 世界
 * @param {string} orderKey order scratch 键
 * @param {string} countsKey 桶计数 scratch 键
 * @param {boolean} reverse true = 深→浅
 * @param {Float32Array} [depth] 已有深度场；缺省则 `fillCellDepths`
 * @returns {Int32Array} 长度 WH 的格序
 */
export const buildDepthOrder = (world, orderKey, countsKey, reverse, depth) => {
	const { worldW: W, worldH: H } = world
	const n = W * H
	const d = depth || fillCellDepths(world)
	const order = scratch(world, orderKey, n, Int32Array)
	const depthBuckets = Math.max(W, H) + 2
	const dCounts = scratch(world, countsKey, depthBuckets, Int32Array)
	dCounts.fill(0)
	const scale = (depthBuckets - 1) / (world.gravityDepthSpan || 1)
	for (let cell = 0; cell < n; cell++) {
		const b = Math.min(depthBuckets - 1, Math.max(0, (d[cell] * scale) | 0))
		dCounts[b]++
	}
	let run = 0
	if (reverse)
		for (let b = depthBuckets - 1; b >= 0; b--) {
			const c = dCounts[b]
			dCounts[b] = run
			run += c
		}
	else
		for (let b = 0; b < depthBuckets; b++) {
			const c = dCounts[b]
			dCounts[b] = run
			run += c
		}
	for (let cell = 0; cell < n; cell++) {
		const b = Math.min(depthBuckets - 1, Math.max(0, (d[cell] * scale) | 0))
		order[dCounts[b]++] = cell
	}
	return order
}

/**
 * 沿重力向下的正交邻格（土壤底面 / 自由面 / 气泡）。w = û_phys·ĝ。
 * @param {FluidWorld} world 世界
 * @returns {{ dx: number[], dy: number[], w: number[], n: number }} 加权邻格
 */
export const gravityDownWeights = (world) => fillGravityWeights(world, DOWN_W, 1, false)

/**
 * 凝聚相沉降邻格：正交 + 倾斜时对角（同一 pressureMove 语言）。
 * @param {FluidWorld} world 世界
 * @returns {{ dx: number[], dy: number[], w: number[], n: number }} 加权邻格
 */
export const gravitySettleWeights = (world) => fillGravityWeights(world, SETTLE_DOWN_W, 1, true)

/**
 * 沿重力向上的正交邻格（w = û_phys·(−ĝ)）。
 * @param {FluidWorld} world 世界
 * @returns {{ dx: number[], dy: number[], w: number[], n: number }} 加权邻格
 */
export const gravityUpWeights = (world) => fillGravityWeights(world, UP_W, -1, false)

/**
 * 垂直于 ĝ 的侧向正交邻格（液膜 / 表面张力）。w = |d̂ × ĝ|（二维叉积模）。
 * @param {FluidWorld} world 世界
 * @returns {{ dx: number[], dy: number[], w: number[], n: number }} 加权邻格
 */
export const gravitySideWeights = (world) => {
	const { gx, gy } = world.gravity
	SIDE_W.n = 0
	for (let o = 0; o < 4; o++) {
		const dx = ORTHO_DX[o]
		const dy = ORTHO_DY[o]
		const cross = Math.abs(dx * gy - dy * gx)
		if (cross <= 1e-6) continue
		const i = SIDE_W.n++
		SIDE_W.dx[i] = dx
		SIDE_W.dy[i] = dy
		SIDE_W.w[i] = cross
	}
	return SIDE_W
}

/**
 * 将动量按质量加权并入格内液体速度（沉积 / 撞击）。
 * @param {FluidWorld} world 世界
 * @param {number} cell 扁平索引
 * @param {number} massBefore 并入前液体质量
 * @param {number} added 并入质量
 * @param {number} vx 入射 vx
 * @param {number} vy 入射 vy
 * @returns {void}
 */
export const impartLiquidMomentum = (world, cell, massBefore, added, vx, vy) => {
	if (added <= 1e-8) return
	const m1 = massBefore + added
	if (m1 <= 1e-8) return
	world.liqVx[cell] = (world.liqVx[cell] * massBefore + vx * added) / m1
	world.liqVy[cell] = (world.liqVy[cell] * massBefore + vy * added) / m1
}

/** 复用的最强上/下邻格（勿长期持有；勿同时保留 up/down 引用）。 */
const STRONG_UP = { dx: 0, dy: 0, w: 0 }
const STRONG_DOWN = { dx: 0, dy: 0, w: 0 }

/**
 * 最强上向邻格方向与权重。
 * @param {FluidWorld} world 世界
 * @returns {{ dx: number, dy: number, w: number }} 最强上向
 */
export const strongestUp = (world) => {
	const up = gravityUpWeights(world)
	if (up.n <= 0) {
		STRONG_UP.dx = 0
		STRONG_UP.dy = 0
		STRONG_UP.w = 0
		return STRONG_UP
	}
	let best = 0
	for (let i = 1; i < up.n; i++)
		if (up.w[i] > up.w[best]) best = i
	STRONG_UP.dx = up.dx[best]
	STRONG_UP.dy = up.dy[best]
	STRONG_UP.w = up.w[best]
	return STRONG_UP
}

/**
 * 最强下向邻格方向与权重。
 * @param {FluidWorld} world 世界
 * @returns {{ dx: number, dy: number, w: number }} 最强下向
 */
export const strongestDown = (world) => {
	const down = gravityDownWeights(world)
	if (down.n <= 0) {
		STRONG_DOWN.dx = 0
		STRONG_DOWN.dy = 0
		STRONG_DOWN.w = 0
		return STRONG_DOWN
	}
	let best = 0
	for (let i = 1; i < down.n; i++)
		if (down.w[i] > down.w[best]) best = i
	STRONG_DOWN.dx = down.dx[best]
	STRONG_DOWN.dy = down.dy[best]
	STRONG_DOWN.w = down.w[best]
	return STRONG_DOWN
}

/**
 * 将重力状态写入世界；方向转过阈值角时标脏。
 * @param {FluidWorld} world 世界
 * @param {GravityState} g 重力
 * @returns {boolean} 方向是否显著变化
 */
export const applyGravityToWorld = (world, g) => {
	const prev = world.gravity
	const dot = prev.gx * g.gx + prev.gy * g.gy
	const flipped = dot < GRAVITY_DIRTY_DOT
	world.gravity.gx = g.gx
	world.gravity.gy = g.gy
	world.gravity.mag = g.mag
	recomputeGravityDepthBasis(world)
	if (flipped) {
		world.airDirty = true
		world.gasGeomDirty = true
	}
	return flipped
}
