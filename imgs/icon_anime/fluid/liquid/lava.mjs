/**
 * 熔岩相：粘滞输运、温度随质量加权，以及与水共享的密度对流。
 * 沉降 / 侧膜走共用凝聚相核 `transport.mjs`。
 */

import { MAT, T_AMB, SUBSTANCE, rhoOf, viscOf, isLiquidBarrier } from '../mat.mjs'
import { cellRho } from '../thermal.mjs'
import {
	scratch, inWorld,
	markAirIfDrawCrossed, markAirIfMeltDrawCrossed,
	gravityDownWeights, buildDepthOrder,
} from '../world.mjs'

import { stepPhaseTransport } from './transport.mjs'

/** @typedef {import('../world.mjs').FluidWorld} FluidWorld */

/**
 * 熔岩格粘滞。
 * @param {FluidWorld} world 世界
 * @param {number} cell 索引
 * @returns {number} 粘滞
 */
export const meltVisc = (world, cell) =>
	viscOf(rhoOf(SUBSTANCE.ROCK, world.temp[cell]))

/**
 * 熔岩可进判定。
 * @param {FluidWorld} world 世界
 * @param {number} cell 索引
 * @returns {boolean} 可进
 */
export const meltCanEnter = (world, cell) => {
	const m = world.mat[cell]
	if (m === MAT.SOLID || m === MAT.HORIZON) return false
	if (isLiquidBarrier(m) && m !== MAT.AIR) return false
	return true
}

/**
 * 熔岩温度质量加权钩子。
 * @param {FluidWorld} world 世界
 * @param {number} src 源
 * @param {number} dst 目标
 * @param {number} moved 质量
 * @param {number} beforeSrc 源前质量
 * @returns {void}
 */
export const meltTempOnTransfer = (world, src, dst, moved, beforeSrc) => {
	const tSrc = world.temp[src]
	const heat = tSrc * moved
	const destMass = world.melt[dst]
	const prevMass = destMass - moved
	world.temp[dst] = prevMass > 0
		? (world.temp[dst] * prevMass + heat) / destMass
		: tSrc
	if (world.melt[src] <= 1e-8) world.temp[src] = T_AMB
}

/**
 * 熔岩输运（共用凝聚相核）。
 * @param {FluidWorld} world 世界
 * @returns {void}
 */
export const stepLava = (world) => {
	stepPhaseTransport(world, {
		mass: world.melt,
		vx: world.meltVx,
		vy: world.meltVy,
		viscAt: meltVisc,
		/**
		 * 熔岩密度（随温度）。
		 * @param {FluidWorld} w 世界
		 * @param {number} cell 格索引
		 * @returns {number} 密度
		 */
		rhoAt: (w, cell) => rhoOf(SUBSTANCE.ROCK, w.temp[cell]),
		canEnter: meltCanEnter,
		onTransfer: meltTempOnTransfer,
		markDirty: markAirIfMeltDrawCrossed,
		flowScratchX: 'meltFlowX',
		flowScratchY: 'meltFlowY',
	})
}

/**
 * 沿重力：下方更轻则与上方交换（对流 / 气泡）。
 * 同时交换熔岩与自由水，使热熔岩可穿过水柱上浮。
 * @param {FluidWorld} world 世界
 * @returns {void}
 */
export const stepBuoyancy = (world) => {
	const { worldW: W, worldH: H, melt, liq, temp, mat } = world
	const n = W * H
	const down = gravityDownWeights(world)
	const order = buildDepthOrder(world, 'buoyOrder', 'buoyCounts', true)

	const swapMark = scratch(world, 'buoyMark', n, Int32Array)
	let gen = (/** @type {number} */ world.scratch.buoyGen | 0) + 1
	if (gen >= 0x7fffffff) {
		swapMark.fill(0)
		gen = 1
	}
	world.scratch.buoyGen = gen

	for (let si = 0; si < n; si++) {
		const a = order[si]
		const x = a % W
		const y = (a / W) | 0
		if (swapMark[a] === gen) continue
		for (let i = 0; i < down.n; i++) {
			if (down.w[i] < 0.5) continue
			const belowX = x + down.dx[i]
			const belowY = y + down.dy[i]
			if (!inWorld(world, belowX, belowY)) continue
			const b = belowY * W + belowX
			if (swapMark[b] === gen) continue
			if (isLiquidBarrier(mat[a]) || isLiquidBarrier(mat[b])) continue
			// Free-fall into empty air is Stokes transport (visc); buoyancy is convection only.
			const occupiedA = melt[a] >= 0.05 || liq[a] >= 0.05
			const occupiedB = melt[b] >= 0.05 || liq[b] >= 0.05
			if (!occupiedA || !occupiedB) continue
			const rhoA = cellRho(world, a)
			const rhoB = cellRho(world, b)
			if (rhoB + 0.04 >= rhoA) continue
			const ma = melt[a]
			const mb = melt[b]
			const ta = temp[a]
			const tb = temp[b]
			const la = liq[a]
			const lb = liq[b]
			melt[a] = mb
			melt[b] = ma
			temp[a] = tb
			temp[b] = ta
			liq[a] = lb
			liq[b] = la
			swapMark[a] = gen
			swapMark[b] = gen
			markAirIfMeltDrawCrossed(world, ma, melt[a])
			markAirIfMeltDrawCrossed(world, mb, melt[b])
			markAirIfDrawCrossed(world, la, liq[a])
			markAirIfDrawCrossed(world, lb, liq[b])
		}
	}
}
