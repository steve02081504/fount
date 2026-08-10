/**
 * 流体世界分配、scratch、泛洪队列与动力学清空。
 */

import { defaultGravity } from '../../gravity.mjs'
import { MAT } from '../mat.mjs'
import { createParticlePool, clearParticlePool } from '../particle_pool.mjs'

/** @typedef {import('../../gravity.mjs').GravityState} GravityState */

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
 *   regions: (import('../gas/index.mjs').AirRegion | undefined)[],
 *   particles: import('../particle_pool.mjs').ParticlePool,
 *   pendingSplash: import('../particle_pool.mjs').ParticlePool,
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
	world.scratch.airEpoch = (/** @type {number} */ world.scratch.airEpoch | 0) + 1
	world.scratch.thermoPEpoch = -1
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

/** 重算重力深度基线。 */
export { recomputeGravityDepthBasis }
