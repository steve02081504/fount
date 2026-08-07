/**
 * 凝聚相输运核：水 / 熔岩共用沉降 + 侧向液膜。
 * 相描述符携带质量场、速度场、粘滞查询与转移后钩子。
 */

import { neighborCoord } from './edges.mjs'
import { pressureMove, sheetMove, applyTransfer, viscGain } from './flow.mjs'
import { pressureAt } from './gas.mjs'
import { MAT, LIQ_DRAW, LIQ_FULL, T_AMB, P_ATM, isLiquidBarrier } from './mat.mjs'
import {
	scratch, inWorld, markAirIfDrawCrossed,
	gravityDownWeights, strongestDown,
} from './world.mjs'

/** @typedef {import('./world.mjs').FluidWorld} FluidWorld */

/**
 * @typedef {{
 *   mass: Float32Array,
 *   vx: Float32Array,
 *   vy: Float32Array,
 *   viscAt: (world: FluidWorld, cell: number) => number,
 *   rhoAt: (world: FluidWorld, cell: number) => number,
 *   canEnter: (world: FluidWorld, x: number, y: number, cell: number) => boolean,
 *   onTransfer?: (world: FluidWorld, src: number, dst: number, moved: number, beforeSrc: number, beforeDst: number) => void,
 *   onBarrier?: (world: FluidWorld, cell: number, before: number) => void,
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
 * 按 neighborCoord 分数合约转移质量（含环绕与出界汇）。
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
 * @param {(world: FluidWorld, before: number, after: number) => void} mark 脏标记
 * @returns {void}
 */
const transferNeighbor = (world, phase, flowX, flowY, W, cell, x, y, dx, dy, move, mark) => {
	if (move <= 1e-8) return
	const mass = phase.mass
	const nb = neighborCoord(world, x, y, dx, dy)
	const crossed = nb.wrappedFrac > 0 || nb.outFrac > 0

	/**
	 * 向格内目标转移。
	 * @param {number} tx 目标列
	 * @param {number} ty 目标行
	 * @param {number} amount 质量
	 * @returns {void}
	 */
	const toCell = (tx, ty, amount) => {
		if (amount <= 1e-8) return
		const target = ty * W + tx
		if (!phase.canEnter(world, tx, ty, target)) return
		const room = LIQ_FULL - mass[target]
		if (room <= 0) return
		const before = mass[cell]
		const beforeT = mass[target]
		const moved = applyTransfer(mass, flowX, flowY, cell, target, tx - x, ty - y, Math.min(amount, room))
		if (moved > 0) {
			phase.onTransfer?.(world, cell, target, moved, before, beforeT)
			mark(world, before, mass[cell])
			mark(world, beforeT, mass[target])
		}
	}

	/**
	 * 出界汇：质量离开网格。
	 * @param {number} amount 质量
	 * @returns {void}
	 */
	const sink = (amount) => {
		if (amount <= 1e-8) return
		const before = mass[cell]
		mass[cell] -= amount
		flowX[cell] += dx * amount
		flowY[cell] += dy * amount
		mark(world, before, mass[cell])
	}

	if (!crossed) {
		toCell(nb.x, nb.y, move)
		return
	}
	if (nb.wrappedFrac > 0) toCell(nb.x, nb.y, move * nb.wrappedFrac)
	if (nb.outFrac > 0) sink(move * nb.outFrac)
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
	const strongDown = strongestDown(world)
	const mark = phase.markDirty ?? markAirIfDrawCrossed

	// --- Settle along gravity-weighted down neighbors ---
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (mass[cell] <= 0.02) continue
			if (isLiquidBarrier(world.mat[cell]) && world.mat[cell] !== MAT.AIR) {
				const before = mass[cell]
				phase.onBarrier?.(world, cell, before)
				continue
			}
			const visc = phase.viscAt(world, cell)
			const rhoSrc = phase.rhoAt(world, cell)
			const pSrc = pressureAt(world, x, y) + rhoSrc * mass[cell]

			for (let i = 0; i < down.n; i++) {
				const dx = down.dx[i]
				const dy = down.dy[i]
				const w = down.w[i]
				const nb = neighborCoord(world, x, y, dx, dy)
				const crossed = nb.wrappedFrac > 0 || nb.outFrac > 0
				let dstMass = 0
				let room = LIQ_FULL
				let pDst = P_ATM
				if (!crossed) {
					const target = nb.y * W + nb.x
					if (!phase.canEnter(world, nb.x, nb.y, target)) continue
					dstMass = mass[target]
					room = LIQ_FULL - dstMass
					if (room <= 0) continue
					pDst = pressureAt(world, nb.x, nb.y) + phase.rhoAt(world, target) * dstMass
				}
				else if (nb.wrappedFrac > 0) {
					const target = nb.y * W + nb.x
					if (phase.canEnter(world, nb.x, nb.y, target)) {
						dstMass = mass[target]
						room = LIQ_FULL - dstMass
						pDst = pressureAt(world, nb.x, nb.y) + phase.rhoAt(world, target) * dstMass
					}
					else if (nb.outFrac <= 0) continue
					// else: wrap target blocked — treat remaining outFrac as ambient sink
				}
				else if (nb.outFrac <= 0) continue
				// pure out: pDst stays P_ATM, room stays LIQ_FULL — never index OOB cells

				let move = pressureMove(pSrc, pDst, mass[cell] * w, room, visc)
				if (move < 0.01 && !crossed && dstMass < mass[cell]) {
					const gain = viscGain(visc)
					if (gain > 0)
						move = Math.min(mass[cell] * 0.5 * w, room, (mass[cell] - dstMass) * 0.5 * w) * gain
				}
				if (move <= 0.01 && crossed && nb.outFrac > 0)
					move = mass[cell] * w
				if (move <= 0.01) continue
				transferNeighbor(world, phase, flowX, flowY, W, cell, x, y, dx, dy, move, mark)
			}
		}

	// --- Side sheet perpendicular to strongest down ---
	let sideA = { dx: -1, dy: 0 }
	let sideB = { dx: 1, dy: 0 }
	if (strongDown.w > 0 && strongDown.dx !== 0) {
		sideA = { dx: 0, dy: -1 }
		sideB = { dx: 0, dy: 1 }
	}

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (mass[cell] < LIQ_DRAW) continue
			const visc = phase.viscAt(world, cell)
			for (const side of [sideA, sideB]) {
				const nb = neighborCoord(world, x, y, side.dx, side.dy)
				const crossed = nb.wrappedFrac > 0 || nb.outFrac > 0
				if (!crossed) {
					const target = nb.y * W + nb.x
					if (!phase.canEnter(world, nb.x, nb.y, target)) continue
					const room = LIQ_FULL - mass[target]
					const move = sheetMove(mass[cell], mass[target], room, visc)
					if (move <= 0) continue
					transferNeighbor(world, phase, flowX, flowY, W, cell, x, y, side.dx, side.dy, move, mark)
				}
				else {
					const move = sheetMove(mass[cell], 0, LIQ_FULL, visc)
					if (move <= 0) continue
					transferNeighbor(world, phase, flowX, flowY, W, cell, x, y, side.dx, side.dy, move, mark)
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
	if (world.melt[src] <= 1e-8) world.temp[src] = T_AMB
}
