/**
 * 格材质、凝聚相填充、湿度/液体/熔岩写入与总量。
 */

import { ORTHO_DX, ORTHO_DY } from '../../hash.mjs'

import { MAT, SOIL_CAP, LIQ_FULL, LIQ_DRAW, isSoilMat, isLiquidBarrier } from '../mat.mjs'
import { totalParticleWater } from '../particle_pool.mjs'

import { inWorld } from './create.mjs'

/** @typedef {import('./create.mjs').FluidWorld} FluidWorld */

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
 * 格内凝聚相填充（自由水 + 熔岩）。
 * @param {FluidWorld} world 世界
 * @param {number} i 扁平索引
 * @returns {number} liq+melt
 */
export const cellFill = (world, i) => world.liq[i] + world.melt[i]

/**
 * 格内剩余凝聚相容量。
 * @param {FluidWorld} world 世界
 * @param {number} i 扁平索引
 * @returns {number} max(0, LIQ_FULL − fill)
 */
export const cellRoom = (world, i) => Math.max(0, LIQ_FULL - world.liq[i] - world.melt[i])

/**
 * 格是否按凝聚相占据（空气拓扑 / 气区掩码）。
 * @param {FluidWorld} world 世界
 * @param {number} i 扁平索引
 * @returns {boolean} fill ≥ LIQ_DRAW
 */
export const isCondensed = (world, i) => world.liq[i] + world.melt[i] >= LIQ_DRAW

/**
 * 凝聚相占用跨越 LIQ_DRAW 时标脏空气几何。
 * @param {FluidWorld} world 世界
 * @param {number} fillBefore 变更前 fill
 * @param {number} fillAfter 变更后 fill
 * @returns {void}
 */
export const markAirIfFillCrossed = (world, fillBefore, fillAfter) => {
	if ((fillBefore >= LIQ_DRAW) === (fillAfter >= LIQ_DRAW)) return
	world.airDirty = true
	world.gasGeomDirty = true
}

/**
 * 在 `(x, y)` 添加游离液体，除非该格为液体屏障或无剩余容量。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} amt 待添加量
 * @returns {number} 存入增量
 */
export const addLiquid = (world, x, y, amt) => {
	const i = y * world.worldW + x
	if (isLiquidBarrier(world.mat[i])) return 0
	const room = cellRoom(world, i)
	if (room <= 0) return 0
	const fillBefore = cellFill(world, i)
	const before = world.liq[i]
	const take = Math.min(amt, room)
	world.liq[i] = before + take
	if (take > 0) markAirIfFillCrossed(world, fillBefore, cellFill(world, i))
	return take
}

/**
 * 把被熔岩挤出的水推到正交邻格；放不下的量由调用方闪蒸。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} amt 水量
 * @returns {number} 仍未安置的水量
 */
const spillDisplacedLiquid = (world, x, y, amt) => {
	let left = amt
	if (left <= 1e-8) return 0
	for (let o = 0; o < 4 && left > 1e-8; o++) {
		const nx = x + ORTHO_DX[o]
		const ny = y + ORTHO_DY[o]
		if (!inWorld(world, nx, ny)) continue
		left -= addLiquid(world, nx, ny, left)
	}
	return left
}

/**
 * 在 `(x, y)` 添加熔岩并设置温度（质量加权）。
 * 体积互斥：room 扣 liq；挤出的水优先溢到邻格，剩余同格供热力闪蒸。
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

	const fillBefore = cellFill(world, i)
	const before = world.melt[i]
	let take = Math.min(amt, LIQ_FULL - before)
	if (take <= 0) return 0

	const need = before + take + world.liq[i] - LIQ_FULL
	if (need > 1e-8 && world.liq[i] > 0) {
		const displace = Math.min(world.liq[i], need)
		const wBefore = world.liq[i]
		world.liq[i] -= displace
		const stranded = spillDisplacedLiquid(world, x, y, displace)
		// Stranded water remains co-located → thermal flash; keep it for mass accounting.
		if (stranded > 1e-8) world.liq[i] += stranded
		markAirIfDrawCrossed(world, wBefore, world.liq[i])
		take = Math.min(take, LIQ_FULL - before - world.liq[i])
		if (take <= 0 && world.liq[i] > 0) {
			// Hard displace: wipe in-cell water so melt can enter; spilled already tried.
			const wipe = world.liq[i]
			world.liq[i] = 0
			markAirIfDrawCrossed(world, wipe, 0)
			take = Math.min(amt, LIQ_FULL - before)
		}
	}
	if (take <= 0) return 0

	const heat = world.temp[i] * before + temp * take
	world.melt[i] = before + take
	world.temp[i] = heat / world.melt[i]
	if (world.mat[i] === MAT.SOLID || world.mat[i] === MAT.HORIZON) {
		world.mat[i] = MAT.AIR
		if (world.land[i]) {
			world.land[i] = 0
			world.soilGeomDirty = true
		}
	}
	markAirIfFillCrossed(world, fillBefore, cellFill(world, i))
	return take
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
