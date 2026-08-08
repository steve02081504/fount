/**
 * 热传导、蒸发、熔化 / 凝固、空气温度平流。
 * 土壤与熔岩同源：温度决定密度与粘滞；跨 T_LIQUIDUS / T_SOLIDUS 翻转 mat 缓存。
 * 空气格参与传导与气体平流，不再强制 T_AMB。
 */

import {
	MAT, LIQ_DRAW,
	T_AMB, T_SOLIDUS, T_LIQUIDUS, T_BOIL,
	SUBSTANCE, rhoOf, viscOf,
	isSoilMat,
} from './mat.mjs'
import { scratch, markAirIfDrawCrossed, markAirIfMeltDrawCrossed, gravityUpWeights, strongestUp, inWorld } from './world/index.mjs'

/** @typedef {import('./world/index.mjs').FluidWorld} FluidWorld */

/** 邻格传导系数。 */
const CONDUCT = 0.08
/** 空气邻格传导（略弱于凝聚相）。 */
const AIR_CONDUCT = 0.045
/** 蒸发带走的潜热 / 质量。 */
const LATENT_EVAP = 0.55
/** 每 tick 蒸发质量上限。 */
const EVAP_RATE = 0.12
/** 蒸汽注入气区的质量倍率。 */
const STEAM_GAS = 0.35
/** 蒸汽注入的局部升温 / 质量。 */
const STEAM_HEAT = 0.4
/** 气体温度上风平流混合。 */
const AIR_ADVECT = 0.22

/**
 * 向气区注入蒸汽质量（升压）并抬局部温度。
 * @param {FluidWorld} world 世界
 * @param {number} cell 扁平索引
 * @param {number} steamMass 蒸汽质量
 * @returns {void}
 */
const injectSteam = (world, cell, steamMass) => {
	if (steamMass <= 0) return
	world.temp[cell] = Math.min(1, world.temp[cell] + steamMass * STEAM_HEAT)
	const rid = world.regionId[cell]
	if (!rid) return
	const region = world.regions[rid]
	if (!region) return
	region.gasAmount += steamMass * STEAM_GAS
	if (!region.openToAtm) {
		region.pressure = Math.max(0.05, Math.min(8, region.gasAmount / Math.max(0.25, region.airCells)))
		world.scratch.thermoPEpoch = -1
	}
}

/**
 * 邻格传导权重（0 = 不计入）。
 * @param {Uint8Array} mat 材质
 * @param {Float32Array} melt 熔岩
 * @param {Float32Array} liq 液体
 * @param {number} ni 邻格
 * @param {boolean} hasMass 本格有凝聚相质量
 * @returns {number} 传导系数
 */
const neighborConduct = (mat, melt, liq, ni, hasMass) => {
	const nMass = melt[ni] > 0.02 || isSoilMat(mat[ni]) || liq[ni] > 0.02
	if (hasMass) 
		// Mass thermal capacity ≫ air: ignore ambient air neighbors so
		// soil melt / lava heat is not quenched in one tick.
		return nMass ? CONDUCT : 0
	
	return nMass || mat[ni] === MAT.AIR ? AIR_CONDUCT : 0
}

/**
 * 热力步进：传导 → 空气平流 → 蒸发 / 闪蒸 → 熔化 / 凝固。
 * @param {FluidWorld} world 流体世界
 * @returns {void}
 */
export const stepThermal = (world) => {
	const { worldW: W, worldH: H, mat, liq, melt, moisture, condense } = world
	const n = W * H
	const prevT = world.temp
	const nextT = scratch(world, 'thermNextT', n, Float32Array)

	// --- Conduction: mass cells only among mass; air cells among air+mass ---
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			const hasMass = melt[cell] > 0.02 || isSoilMat(mat[cell]) || liq[cell] > 0.02
			const isAir = !hasMass && mat[cell] === MAT.AIR
			if (!hasMass && !isAir) {
				nextT[cell] = T_AMB
				continue
			}
			let acc = prevT[cell]
			let w = 1
			if (x > 0) {
				const c = neighborConduct(mat, melt, liq, cell - 1, hasMass)
				if (c) { acc += prevT[cell - 1] * c; w += c }
			}
			if (x + 1 < W) {
				const c = neighborConduct(mat, melt, liq, cell + 1, hasMass)
				if (c) { acc += prevT[cell + 1] * c; w += c }
			}
			if (y > 0) {
				const c = neighborConduct(mat, melt, liq, cell - W, hasMass)
				if (c) { acc += prevT[cell - W] * c; w += c }
			}
			if (y + 1 < H) {
				const c = neighborConduct(mat, melt, liq, cell + W, hasMass)
				if (c) { acc += prevT[cell + W] * c; w += c }
			}
			nextT[cell] = acc / w
		}

	// --- Air temperature advection by gas velocity ---
	// Reuse prevT as advect output (drop dedicated thermAdvT); read conduction from nextT.
	const gasUx = world.gasUx
	const gasUy = world.gasUy
	prevT.set(nextT)
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (mat[cell] !== MAT.AIR) continue
			if (melt[cell] > 0.02 || liq[cell] > 0.02) continue
			const ux = gasUx[cell]
			const uy = gasUy[cell]
			const ox = ux > 0.05 ? -1 : ux < -0.05 ? 1 : 0
			const oy = uy > 0.05 ? -1 : uy < -0.05 ? 1 : 0
			if (ox === 0 && oy === 0) continue
			const sx = x + ox
			const sy = y + oy
			if (!inWorld(world, sx, sy)) continue
			const src = sy * W + sx
			if (mat[src] !== MAT.AIR && melt[src] <= 0.02 && !isSoilMat(mat[src]) && liq[src] <= 0.02)
				continue
			const speed = Math.min(1, Math.hypot(ux, uy) * 0.35)
			prevT[cell] = nextT[cell] + (nextT[src] - nextT[cell]) * AIR_ADVECT * speed
		}

	// world.temp stays prevT; thermNextT keeps nextT for the next tick.
	const temp = prevT

	const upW = gravityUpWeights(world)
	const up = strongestUp(world, upW)

	// --- Flash water on melt; evaporate soil moisture; melt/solidify ---
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x

			if (melt[cell] >= LIQ_DRAW && liq[cell] > 0) {
				const flash = liq[cell]
				const before = liq[cell]
				liq[cell] = 0
				markAirIfDrawCrossed(world, before, 0)
				temp[cell] = Math.max(T_AMB, temp[cell] - flash * LATENT_EVAP)
				injectSteam(world, cell, flash)
			}

			if (isSoilMat(mat[cell]) && temp[cell] >= T_BOIL) {
				let latentLoss = 0
				if (moisture[cell] > 0) {
					const take = Math.min(EVAP_RATE, moisture[cell], (temp[cell] - T_BOIL + 0.05) * 0.4)
					if (take > 1e-8) {
						moisture[cell] -= take
						latentLoss += take * LATENT_EVAP
						let above = cell
						if (up.w > 0) {
							const ax = x + up.dx
							const ay = y + up.dy
							if (inWorld(world, ax, ay)) above = ay * W + ax
						}
						injectSteam(world, above, take)
					}
				}
				if (condense[cell] > 0) {
					const take = Math.min(EVAP_RATE, condense[cell])
					if (take > 1e-8) {
						condense[cell] -= take
						latentLoss += take * LATENT_EVAP * 0.5
						injectSteam(world, cell, take)
					}
				}
				if (latentLoss > 0)
					temp[cell] = Math.max(T_AMB, temp[cell] - latentLoss)
			}

			if (isSoilMat(mat[cell]) && moisture[cell] < 1e-6 && temp[cell] >= T_LIQUIDUS) {
				const before = melt[cell]
				melt[cell] = 1
				mat[cell] = MAT.AIR
				world.land[cell] = 0
				moisture[cell] = 0
				condense[cell] = 0
				world.airDirty = true
				world.gasGeomDirty = true
				world.soilGeomDirty = true
				markAirIfMeltDrawCrossed(world, before, melt[cell])
				continue
			}

			if (melt[cell] >= LIQ_DRAW && temp[cell] < T_SOLIDUS) {
				const amount = melt[cell]
				melt[cell] = 0
				markAirIfMeltDrawCrossed(world, amount, 0)
				mat[cell] = MAT.SOLID
				world.land[cell] = 1
				moisture[cell] = 0
				world.airDirty = true
				world.gasGeomDirty = true
				world.soilGeomDirty = true
			}
		}

	// Horizon refresh: soil surface cells keep HORIZON when open above along −ĝ.
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (mat[cell] !== MAT.SOLID && mat[cell] !== MAT.HORIZON) continue
			let openAbove = upW.n <= 0
			if (!openAbove) {
				openAbove = true
				for (let i = 0; i < upW.n; i++) {
					const ux = x + upW.dx[i]
					const uy = y + upW.dy[i]
					if (ux < 0 || uy < 0 || ux >= W || uy >= H) continue
					const above = uy * W + ux
					if (isSoilMat(world.mat[above]) || world.melt[above] >= LIQ_DRAW) {
						openAbove = false
						break
					}
				}
			}
			mat[cell] = openAbove ? MAT.HORIZON : MAT.SOLID
		}
}

/**
 * 格的有效密度（空气 / 水 / 岩熔；同格双相质量加权）。
 * @param {FluidWorld} world 世界
 * @param {number} cell 索引
 * @returns {number} rho
 */
export const cellRho = (world, cell) => {
	const m = world.melt[cell]
	const l = world.liq[cell]
	const fill = m + l
	if (fill > 0.02) {
		if (m > 1e-6 && l > 1e-6) {
			const rhoM = rhoOf(SUBSTANCE.ROCK, world.temp[cell])
			const rhoL = rhoOf(SUBSTANCE.WATER, T_AMB)
			return (rhoM * m + rhoL * l) / fill
		}
		if (m > 1e-6) return rhoOf(SUBSTANCE.ROCK, world.temp[cell])
		return rhoOf(SUBSTANCE.WATER, T_AMB)
	}
	if (isSoilMat(world.mat[cell]))
		return rhoOf(SUBSTANCE.ROCK, world.temp[cell])
	return rhoOf(SUBSTANCE.AIR, world.temp[cell])
}

/**
 * 熔岩格粘滞（由温度密度决定）。
 * @param {FluidWorld} world 世界
 * @param {number} cell 索引
 * @returns {number} 粘滞
 */
export const meltVisc = (world, cell) =>
	viscOf(rhoOf(SUBSTANCE.ROCK, world.temp[cell]))
