/**
 * 热传导、蒸发、熔化 / 凝固。
 * 土壤与熔岩同源：温度决定密度与粘滞；跨 T_LIQUIDUS / T_SOLIDUS 翻转 mat 缓存。
 */

import {
	MAT, LIQ_DRAW,
	T_AMB, T_SOLIDUS, T_LIQUIDUS, T_BOIL,
	SUBSTANCE, rhoOf, viscOf,
	isSoilMat,
} from './mat.mjs'
import { scratch, markAirIfDrawCrossed, markAirIfMeltDrawCrossed, gravityUpWeights, strongestUp, inWorld } from './world.mjs'

/** @typedef {import('./world.mjs').FluidWorld} FluidWorld */

/** 邻格传导系数。 */
const CONDUCT = 0.08
/** 蒸发带走的潜热 / 质量。 */
const LATENT_EVAP = 0.55
/** 每 tick 蒸发质量上限。 */
const EVAP_RATE = 0.12
/** 蒸汽注入气区的质量倍率。 */
const STEAM_GAS = 0.35

/**
 * 向气区注入蒸汽质量（升压）。
 * @param {FluidWorld} world 世界
 * @param {number} cell 扁平索引
 * @param {number} steamMass 蒸汽质量
 * @returns {void}
 */
const injectSteam = (world, cell, steamMass) => {
	if (steamMass <= 0) return
	const rid = world.regionId[cell]
	if (!rid) return
	const region = world.regions[rid]
	if (!region) return
	region.gasAmount += steamMass * STEAM_GAS
	if (!region.openToAtm)
		region.pressure = Math.max(0.05, Math.min(8, region.gasAmount / Math.max(0.25, region.airCells)))
}

/**
 * 热力步进：传导 → 蒸发 / 闪蒸 → 熔化 / 凝固。
 * @param {FluidWorld} world 流体世界
 * @returns {void}
 */
export const stepThermal = (world) => {
	const { worldW: W, worldH: H, mat, liq, melt, temp, moisture, condense } = world
	const n = W * H
	const nextT = scratch(world, 'thermNextT', n, Float32Array)
	nextT.set(temp)

	// --- Conduction among rock / melt / water-bearing cells ---
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			const hasMass = melt[cell] > 0.02 || isSoilMat(mat[cell]) || liq[cell] > 0.02
			if (!hasMass) {
				nextT[cell] = T_AMB
				continue
			}
			let acc = temp[cell]
			let w = 1
			if (x > 0) {
				const ni = cell - 1
				const nMass = melt[ni] > 0.02 || isSoilMat(mat[ni]) || liq[ni] > 0.02
				if (nMass) { acc += temp[ni] * CONDUCT; w += CONDUCT }
			}
			if (x + 1 < W) {
				const ni = cell + 1
				const nMass = melt[ni] > 0.02 || isSoilMat(mat[ni]) || liq[ni] > 0.02
				if (nMass) { acc += temp[ni] * CONDUCT; w += CONDUCT }
			}
			if (y > 0) {
				const ni = cell - W
				const nMass = melt[ni] > 0.02 || isSoilMat(mat[ni]) || liq[ni] > 0.02
				if (nMass) { acc += temp[ni] * CONDUCT; w += CONDUCT }
			}
			if (y + 1 < H) {
				const ni = cell + W
				const nMass = melt[ni] > 0.02 || isSoilMat(mat[ni]) || liq[ni] > 0.02
				if (nMass) { acc += temp[ni] * CONDUCT; w += CONDUCT }
			}
			nextT[cell] = acc / w
		}

	temp.set(nextT)

	const upW = gravityUpWeights(world)
	const up = strongestUp(world)

	// --- Flash water on melt; evaporate soil moisture ---
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
		}

	// --- Melt soil when dry + hot; solidify cool melt ---
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x

			if (isSoilMat(mat[cell]) && moisture[cell] < 1e-6 && temp[cell] >= T_LIQUIDUS) {
				const before = melt[cell]
				melt[cell] = 1
				mat[cell] = MAT.AIR
				moisture[cell] = 0
				condense[cell] = 0
				world.airDirty = true
				world.gasGeomDirty = true
				markAirIfMeltDrawCrossed(world, before, melt[cell])
				continue
			}

			if (melt[cell] >= LIQ_DRAW && temp[cell] < T_SOLIDUS) {
				const amount = melt[cell]
				melt[cell] = 0
				markAirIfMeltDrawCrossed(world, amount, 0)
				mat[cell] = MAT.SOLID
				moisture[cell] = 0
				world.airDirty = true
				world.gasGeomDirty = true
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
 * 格的有效密度（空气 / 水 / 岩熔连续体）。
 * @param {FluidWorld} world 世界
 * @param {number} cell 索引
 * @returns {number} rho
 */
export const cellRho = (world, cell) => {
	if (world.melt[cell] >= LIQ_DRAW)
		return rhoOf(SUBSTANCE.ROCK, world.temp[cell])
	if (world.liq[cell] >= LIQ_DRAW)
		return rhoOf(SUBSTANCE.WATER, T_AMB)
	if (isSoilMat(world.mat[cell]))
		return rhoOf(SUBSTANCE.ROCK, world.temp[cell])
	return rhoOf(SUBSTANCE.AIR, T_AMB)
}

/**
 * 熔岩格粘滞。
 * @param {FluidWorld} world 世界
 * @param {number} cell 索引
 * @returns {number} 粘滞
 */
export const meltVisc = (world, cell) =>
	viscOf(rhoOf(SUBSTANCE.ROCK, world.temp[cell]))
