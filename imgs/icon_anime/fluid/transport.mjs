/**
 * 凝聚相输运核：水 / 熔岩共用沉降 + 侧向液膜。
 * 相描述符携带质量场、速度场、粘滞查询与转移后钩子。
 */

import { neighborCoord } from './edges.mjs'
import { pressureMove, sheetMove, applyTransfer } from './flow.mjs'
import { pressureAt } from './gas.mjs'
import { MAT, RHO_G, LIQ_DRAW, LIQ_FULL, isLiquidBarrier } from './mat.mjs'
import {
	scratch, inWorld, markAirIfDrawCrossed,
	gravityDownWeights,
} from './world.mjs'

/** @typedef {import('./world.mjs').FluidWorld} FluidWorld */

/**
 * @typedef {{
 *   mass: Float32Array,
 *   vx: Float32Array,
 *   vy: Float32Array,
 *   viscAt: (world: FluidWorld, cell: number) => number,
 *   canEnter: (world: FluidWorld, x: number, y: number, cell: number) => boolean,
 *   onTransfer?: (world: FluidWorld, src: number, dst: number, moved: number, beforeSrc: number, beforeDst: number) => void,
 *   markDirty?: (world: FluidWorld, before: number, after: number) => void,
 *   flowScratchX: string,
 *   flowScratchY: string,
 * }} PhaseDesc
 */

/**
 * 默认：AIR / POOL 可进；土壤不可。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} cell 索引
 * @returns {boolean} 可进
 */
export const defaultCanEnter = (world, x, y, cell) => {
	if (!inWorld(world, x, y)) return false
	const m = world.mat[cell]
	if (isLiquidBarrier(m)) return false
	if (m === MAT.POOL) return world.liq[cell] < LIQ_FULL
	return true
}

/**
 * 熔岩可进判定。
 * @param {FluidWorld} world 世界
 * @param {number} _x 列
 * @param {number} _y 行
 * @param {number} cell 索引
 * @returns {boolean} 可进
 */
export const meltCanEnter = (world, _x, _y, cell) => {
	const m = world.mat[cell]
	if (m === MAT.SOLID || m === MAT.HORIZON) return false
	if (isLiquidBarrier(m) && m !== MAT.AIR) return false
	return true
}

/**
 * 推进一凝聚相：沿重力加权沉降 + 垂直方向侧向液膜。
 * @param {FluidWorld} world 世界
 * @param {PhaseDesc} phase 相描述
 * @returns {void}
 */
export const stepPhaseTransport = (world, phase) => {
	const { worldW: W, worldH: H } = world
	const n = W * H
	const mass = phase.mass
	const flowX = scratch(world, phase.flowScratchX, n, Float32Array)
	const flowY = scratch(world, phase.flowScratchY, n, Float32Array)
	flowX.fill(0)
	flowY.fill(0)
	const down = gravityDownWeights(world)
	const mark = phase.markDirty ?? markAirIfDrawCrossed

	// --- Settle along gravity-weighted down neighbors ---
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (mass[cell] <= 0.02) continue
			if (isLiquidBarrier(world.mat[cell]) && world.mat[cell] !== MAT.AIR) {
				if (phase.mass === world.liq) {
					const before = mass[cell]
					mass[cell] = 0
					mark(world, before, 0)
				}
				continue
			}
			const visc = phase.viscAt(world, cell)
			const pSrc = pressureAt(world, x, y) + RHO_G * mass[cell]

			for (let i = 0; i < down.n; i++) {
				const dx = down.dx[i]
				const dy = down.dy[i]
				const w = down.w[i]
				const nb = neighborCoord(world, x, y, dx, dy)
				if (nb.out) continue
				const tx = nb.x
				const ty = nb.y
				if (!phase.canEnter(world, tx, ty, ty * W + tx)) continue
				const target = ty * W + tx
				const room = LIQ_FULL - mass[target]
				if (room <= 0) continue
				const pDst = pressureAt(world, tx, ty) + RHO_G * mass[target]
				let move = pressureMove(pSrc, pDst, mass[cell] * w, room, visc)
				if (move < 0.01 && mass[target] < mass[cell])
					move = Math.min(mass[cell] * 0.5 * w, room, (mass[cell] - mass[target]) * 0.5 * w) * (1 - Math.min(1, visc))
				if (move <= 0.01) continue
				const before = mass[cell]
				const beforeT = mass[target]
				const moved = applyTransfer(mass, flowX, flowY, cell, target, tx - x, ty - y, move)
				if (moved > 0) {
					phase.onTransfer?.(world, cell, target, moved, before, beforeT)
					mark(world, before, mass[cell])
					mark(world, beforeT, mass[target])
				}
			}
		}

	// --- Side sheet perpendicular to strongest down ---
	let sideA = { dx: -1, dy: 0 }
	let sideB = { dx: 1, dy: 0 }
	if (down.n > 0) {
		let best = 0
		for (let i = 1; i < down.n; i++)
			if (down.w[i] > down.w[best]) best = i
		if (down.dx[best] !== 0) {
			sideA = { dx: 0, dy: -1 }
			sideB = { dx: 0, dy: 1 }
		}
	}

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (mass[cell] < LIQ_DRAW) continue
			const visc = phase.viscAt(world, cell)
			for (const side of [sideA, sideB]) {
				const nb = neighborCoord(world, x, y, side.dx, side.dy)
				if (nb.out) continue
				const target = nb.y * W + nb.x
				if (!phase.canEnter(world, nb.x, nb.y, target)) continue
				const room = LIQ_FULL - mass[target]
				const move = sheetMove(mass[cell], mass[target], room, visc)
				if (move <= 0) continue
				const before = mass[cell]
				const beforeT = mass[target]
				const moved = applyTransfer(mass, flowX, flowY, cell, target, nb.x - x, nb.y - y, move)
				if (moved > 0) {
					phase.onTransfer?.(world, cell, target, moved, before, beforeT)
					mark(world, before, mass[cell])
					mark(world, beforeT, mass[target])
				}
			}
		}

	for (let i = 0; i < n; i++) {
		const m = mass[i]
		if (m < 1e-6) {
			phase.vx[i] = 0
			phase.vy[i] = 0
			continue
		}
		phase.vx[i] = phase.vx[i] * 0.35 + (flowX[i] / m) * 0.65
		phase.vy[i] = phase.vy[i] * 0.35 + (flowY[i] / m) * 0.65
	}
}

/**
 * 熔岩温度质量加权钩子。
 * @param {FluidWorld} world 世界
 * @param {number} src 源
 * @param {number} dst 目标
 * @param {number} moved 质量
 * @param {number} beforeSrc 源前质量
 * @param {number} _beforeDst 目标前质量
 * @returns {void}
 */
export const meltTempOnTransfer = (world, src, dst, moved, beforeSrc, _beforeDst) => {
	const tSrc = world.temp[src]
	const heat = tSrc * moved
	const destMass = world.melt[dst]
	const prevMass = destMass - moved
	world.temp[dst] = prevMass > 0
		? (world.temp[dst] * prevMass + heat) / destMass
		: tSrc
	if (world.melt[src] <= 1e-8) world.temp[src] = 0
}
