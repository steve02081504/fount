/**
 * 凝聚相 Stokes 输运核：熔岩等粘滞相的沉降 + 侧向液膜。
 * 压强走 `condensedPressureAt`（与水同一静水柱语言）。
 * 水相因 POOL / 密闭气特化，见 `water.mjs`。
 */

import { neighborCoord } from '../edges.mjs'
import { pressureMove, sheetMove, applyTransfer, viscGain, inertiaMove } from '../flow.mjs'
import { pressureAt } from '../gas/index.mjs'
import { MAT, LIQ_DRAW, LIQ_FULL, P_ATM, ST_DRY_FRAC, isLiquidBarrier } from '../mat.mjs'
import {
	scratch, markAirIfFillCrossed, cellRoom, cellFill, fillCellDepths,
	gravitySideWeights, gravitySettleWeights, buildDepthOrder,
} from '../world/index.mjs'

import { beginLiquidPressure } from './pressure.mjs'

/** @typedef {import('../world/index.mjs').FluidWorld} FluidWorld */

/**
 * @typedef {{
 *   mass: Float32Array,
 *   vx: Float32Array,
 *   vy: Float32Array,
 *   viscAt: (world: FluidWorld, cell: number) => number,
 *   rhoAt: (world: FluidWorld, cell: number) => number,
 *   canEnter: (world: FluidWorld, cell: number) => boolean,
 *   onTransfer?: (world: FluidWorld, src: number, dst: number, moved: number, beforeSrc: number) => void,
 *   onBarrier?: (world: FluidWorld, cell: number, before: number) => void,
 *   markDirty?: (world: FluidWorld, before: number, after: number) => void,
 *   flowScratchX: string,
 *   flowScratchY: string,
 * }} PhaseDesc
 */

/**
 * 向格内目标转移（体积互斥 room）。
 * @param {FluidWorld} world 世界
 * @param {PhaseDesc} phase 相描述
 * @param {Float32Array} flowX 水平流
 * @param {Float32Array} flowY 垂直流
 * @param {Float32Array} mass 质量场
 * @param {number} W 宽
 * @param {number} cell 源索引
 * @param {number} x 源列
 * @param {number} y 源行
 * @param {number} tx 目标列
 * @param {number} ty 目标行
 * @param {number} amount 质量
 * @returns {void}
 */
const transferToCell = (world, phase, flowX, flowY, mass, W, cell, x, y, tx, ty, amount) => {
	if (amount <= 1e-8) return
	const target = ty * W + tx
	if (!phase.canEnter(world, target)) return
	const room = cellRoom(world, target)
	if (room <= 0) return
	const fillS = cellFill(world, cell)
	const fillT = cellFill(world, target)
	const before = mass[cell]
	const beforeT = mass[target]
	const moved = applyTransfer(mass, flowX, flowY, cell, target, tx - x, ty - y, Math.min(amount, room), room)
	if (moved > 0) {
		phase.onTransfer?.(world, cell, target, moved, before, beforeT)
		markAirIfFillCrossed(world, fillS, cellFill(world, cell))
		markAirIfFillCrossed(world, fillT, cellFill(world, target))
	}
}

/**
 * 出界汇：质量离开网格。
 * @param {Float32Array} mass 质量场
 * @param {Float32Array} flowX 水平流
 * @param {Float32Array} flowY 垂直流
 * @param {number} cell 源索引
 * @param {number} dx 方向列偏移
 * @param {number} dy 方向行偏移
 * @param {number} amount 质量
 * @param {FluidWorld} world 世界
 * @returns {void}
 */
const sinkOut = (mass, flowX, flowY, cell, dx, dy, amount, world) => {
	if (amount <= 1e-8) return
	const fillBefore = cellFill(world, cell)
	mass[cell] -= amount
	flowX[cell] += dx * amount
	flowY[cell] += dy * amount
	markAirIfFillCrossed(world, fillBefore, cellFill(world, cell))
}

/**
 * 按已解析的邻格合约转移质量（含环绕与出界汇）。
 * @param {FluidWorld} world 世界
 * @param {PhaseDesc} phase 相描述
 * @param {Float32Array} flowX 水平流
 * @param {Float32Array} flowY 垂直流
 * @param {number} W 宽
 * @param {number} cell 源索引
 * @param {number} x 源列
 * @param {number} y 源行
 * @param {number} dx 方向列偏移
 * @param {number} dy 方向行偏移
 * @param {number} move 待移质量
 * @param {number} nbX 邻格列（环绕后）
 * @param {number} nbY 邻格行
 * @param {number} wrappedFrac 环绕份额
 * @param {number} outFrac 出界份额
 * @returns {void}
 */
const transferNeighbor = (world, phase, flowX, flowY, W, cell, x, y, dx, dy, move, nbX, nbY, wrappedFrac, outFrac) => {
	if (move <= 1e-8) return
	const mass = phase.mass
	const crossed = wrappedFrac > 0 || outFrac > 0
	if (!crossed) {
		transferToCell(world, phase, flowX, flowY, mass, W, cell, x, y, nbX, nbY, move)
		return
	}
	if (wrappedFrac > 0)
		transferToCell(world, phase, flowX, flowY, mass, W, cell, x, y, nbX, nbY, move * wrappedFrac)
	if (outFrac > 0)
		sinkOut(mass, flowX, flowY, cell, dx, dy, move * outFrac, world)
}

/**
 * 推进一凝聚相：沿重力加权沉降 + 垂直重力侧向液膜。
 * @param {FluidWorld} world 世界
 * @param {PhaseDesc} phase 相描述
 * @param {{ depth?: Float32Array, order?: Int32Array, pAt?: (x: number, y: number) => number, markDirty?: (x: number, y: number) => void }} [opts] 可复用深度序 / 压强
 * @returns {void}
 */
export const stepPhaseTransport = (world, phase, opts) => {
	const { worldW: W, worldH: H } = world
	const n = W * H
	const mass = phase.mass
	const flowX = scratch(world, phase.flowScratchX, n, Float32Array)
	const flowY = scratch(world, phase.flowScratchY, n, Float32Array)
	flowX.fill(0)
	flowY.fill(0)
	const down = gravitySettleWeights(world)

	const depth = opts?.depth ?? fillCellDepths(world)
	const order = opts?.order ?? buildDepthOrder(world, 'phaseOrder', 'phaseDepthCounts', true, depth)
	const pressure = opts?.pAt && opts?.markDirty
		? { pAt: opts.pAt, markDirty: opts.markDirty }
		: beginLiquidPressure(world)
	const { pAt, markDirty } = pressure

	const viscBuf = scratch(world, 'phaseVisc', n, Float32Array)
	const vx = phase.vx
	const vy = phase.vy

	// --- Settle along gravity-weighted down neighbors ---
	for (let si = 0; si < n; si++) {
		const cell = order[si]
		const x = cell % W
		const y = (cell / W) | 0
		if (mass[cell] <= 0.02) continue
		if (isLiquidBarrier(world.mat[cell]) && world.mat[cell] !== MAT.AIR) {
			phase.onBarrier?.(world, cell, mass[cell])
			continue
		}
		const visc = viscBuf[cell] = phase.viscAt(world, cell)
		const rhoSrc = phase.rhoAt(world, cell)
		// Sub-draw blobs use local fill head (free-fall); pools use condensed column cache.
		const pSrc = mass[cell] >= LIQ_DRAW
			? pAt(x, y)
			: pressureAt(world, x, y) + rhoSrc * mass[cell]

		for (let i = 0; i < down.n; i++) {
			const dx = down.dx[i]
			const dy = down.dy[i]
			const w = down.w[i]
			const nb = neighborCoord(world, x, y, dx, dy)
			const nbX = nb.x
			const nbY = nb.y
			const wrappedFrac = nb.wrappedFrac
			const outFrac = nb.outFrac
			const crossed = wrappedFrac > 0 || outFrac > 0
			let dstMass = 0
			let room = LIQ_FULL
			let pDst = P_ATM
			if (!crossed) {
				const target = nbY * W + nbX
				if (!phase.canEnter(world, target)) continue
				dstMass = mass[target]
				room = cellRoom(world, target)
				if (room <= 0) continue
				pDst = dstMass >= LIQ_DRAW
					? pAt(nbX, nbY)
					: pressureAt(world, nbX, nbY) + phase.rhoAt(world, target) * dstMass
			}
			else if (wrappedFrac > 0) {
				const target = nbY * W + nbX
				if (phase.canEnter(world, target)) {
					dstMass = mass[target]
					room = cellRoom(world, target)
					pDst = dstMass >= LIQ_DRAW
						? pAt(nbX, nbY)
						: pressureAt(world, nbX, nbY) + phase.rhoAt(world, target) * dstMass
				}
				else if (outFrac <= 0) continue
			}
			else if (outFrac <= 0) continue

			let move = pressureMove(pSrc, pDst, mass[cell] * w, room, visc)
			if (move < 0.01 && !crossed && dstMass < mass[cell]) {
				const gain = viscGain(visc)
				if (gain > 0)
					move = Math.min(mass[cell] * 0.5 * w, room, (mass[cell] - dstMass) * 0.5 * w) * gain
			}
			if (!crossed)
				move = Math.max(move, inertiaMove(vx[cell], vy[cell], dx, dy, mass[cell] * w, room, visc))
			if (move <= 0.01 && crossed && outFrac > 0)
				move = mass[cell] * w
			if (move <= 0.01) continue
			transferNeighbor(world, phase, flowX, flowY, W, cell, x, y, dx, dy, move, nbX, nbY, wrappedFrac, outFrac)
			markDirty(x, y)
		}
	}

	// --- Side sheet perpendicular to ĝ ---
	const sides = gravitySideWeights(world)

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (mass[cell] < LIQ_DRAW) continue
			let visc = viscBuf[cell]
			if (!(visc > 0)) visc = viscBuf[cell] = phase.viscAt(world, cell)
			for (let si = 0; si < sides.n; si++) {
				const dx = sides.dx[si]
				const dy = sides.dy[si]
				const nb = neighborCoord(world, x, y, dx, dy)
				const nbX = nb.x
				const nbY = nb.y
				const wrappedFrac = nb.wrappedFrac
				const outFrac = nb.outFrac
				const crossed = wrappedFrac > 0 || outFrac > 0
				if (!crossed) {
					const target = nbY * W + nbX
					if (!phase.canEnter(world, target)) continue
					const room = cellRoom(world, target)
					if (room <= 0) continue
					const dry = mass[target] < LIQ_DRAW
					const move = sheetMove(mass[cell], mass[target], room, visc) * (dry ? ST_DRY_FRAC : 1)
					if (move <= 0) continue
					transferNeighbor(world, phase, flowX, flowY, W, cell, x, y, dx, dy, move, nbX, nbY, 0, 0)
					markDirty(x, y)
					markDirty(nbX, nbY)
				}
				else {
					const move = sheetMove(mass[cell], 0, LIQ_FULL, visc) * ST_DRY_FRAC
					if (move <= 0) continue
					transferNeighbor(world, phase, flowX, flowY, W, cell, x, y, dx, dy, move, nbX, nbY, wrappedFrac, outFrac)
					markDirty(x, y)
				}
			}
		}

	for (let i = 0; i < n; i++) {
		const m = mass[i]
		if (m < 1e-6) {
			vx[i] = 0
			vy[i] = 0
			continue
		}
		vx[i] = vx[i] * 0.35 + (flowX[i] / m) * 0.65
		vy[i] = vy[i] * 0.35 + (flowY[i] / m) * 0.65
	}
}
