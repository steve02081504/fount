/**
 * 流体世界网格：材质、液体、土壤水、气体速度、粒子。
 */

import { MAT, SOIL_CAP, LIQ_FULL, LIQ_DRAW, isSoilMat, isLiquidBarrier } from './mat.mjs'
import { createParticlePool, clearParticlePool, totalParticleWater } from './particles.mjs'

/** @typedef {{
 *   viewW: number, viewH: number, worldW: number, worldH: number,
 *   margin: number, ox: number, oy: number,
 *   mat: Uint8Array, liq: Float32Array, moisture: Float32Array, condense: Float32Array,
 *   gasUx: Float32Array, gasUy: Float32Array,
 *   liqVx: Float32Array, liqVy: Float32Array,
 *   regionId: Int32Array,
 *   regions: (import('./gas.mjs').AirRegion | undefined)[],
 *   particles: import('./particles.mjs').ParticlePool,
 *   pendingSplash: import('./particles.mjs').ParticlePool,
 *   soilStep: number, gasTime: number,
 *   airDirty: boolean,
 *   gasGeomDirty: boolean,
 *   maxUpdraft: number,
 *   scratch: Record<string, unknown>,
 *   floodQ: number[],
 * }} FluidWorld
 */

/**
 * 为视口矩形加边距分配流体世界。
 * @param {{ width: number, height: number, margin?: number, bottomExtra?: number }} [opts] 视口尺寸
 * @returns {FluidWorld} 空世界
 */
export const createWorld = ({ width, height, margin = 24, bottomExtra = 4 } = {}) => {
	const worldW = width + margin * 2
	const worldH = height + bottomExtra
	const size = worldW * worldH
	return {
		viewW: width, viewH: height, worldW, worldH, margin, ox: margin, oy: 0,
		mat: new Uint8Array(size),
		liq: new Float32Array(size),
		moisture: new Float32Array(size),
		condense: new Float32Array(size),
		gasUx: new Float32Array(size),
		gasUy: new Float32Array(size),
		liqVx: new Float32Array(size),
		liqVy: new Float32Array(size),
		regionId: new Int32Array(size),
		regions: [],
		particles: createParticlePool(),
		pendingSplash: createParticlePool(),
		soilStep: 0,
		gasTime: 0,
		airDirty: true,
		/** 空气拓扑（或材质）变化时重建气体 blocked/span 缓存。 */
		gasGeomDirty: true,
		/** `stepGas` 后最负的 gas uy；气体未步进前为 `NaN`。 */
		maxUpdraft: NaN,
		scratch: {},
		floodQ: [],
	}
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
 * 清空 BFS 泛洪队列。
 * @param {FluidWorld} world 世界
 * @returns {void}
 */
export const floodClear = (world) => {
	world.floodQ.length = 0
}

/**
 * 将 `(x, y)` 压入泛洪队列。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {void}
 */
export const floodPush = (world, x, y) => {
	world.floodQ.push(x, y)
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
 * 清空液体、湿度、气体、粒子与区域标签。
 * @param {FluidWorld} world 世界
 * @returns {void}
 */
export const clearDynamics = (world) => {
	world.liq.fill(0)
	world.moisture.fill(0)
	world.condense.fill(0)
	world.gasUx.fill(0)
	world.gasUy.fill(0)
	world.liqVx.fill(0)
	world.liqVy.fill(0)
	clearParticlePool(world.particles)
	clearParticlePool(world.pendingSplash)
	world.regionId.fill(0)
	world.regions.length = 0
	world.gasTime = 0
	world.airDirty = true
	world.gasGeomDirty = true
	world.maxUpdraft = NaN
}

/**
 * 仅清空材质标签——湿度/凝结在重建间保留。
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
 * 在 `(x, y)` 添加游离液体，除非该格为液体屏障。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} amt 待添加量
 * @returns {number} 存入增量
 */
export const addLiquid = (world, x, y, amt) => {
	const i = y * world.worldW + x
	if (isLiquidBarrier(world.mat[i])) return 0
	const before = world.liq[i]
	world.liq[i] = Math.min(LIQ_FULL, before + amt)
	const stored = world.liq[i] - before
	if (stored > 0) markAirIfDrawCrossed(world, before, world.liq[i])
	return stored
}
