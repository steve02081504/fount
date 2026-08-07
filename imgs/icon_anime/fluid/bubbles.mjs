/**
 * 熔岩气泡：密闭气区在熔岩中沿 −ĝ 浮升，至自由面破裂。
 */

import { LIQ_DRAW, BUBBLE_MIN_CELLS, BUBBLE_MIN_MELT_CONTACT } from './mat.mjs'
import { gravityUpWeights, gravityDownWeights, markAirIfMeltDrawCrossed } from './world.mjs'

/** @typedef {import('./world.mjs').FluidWorld} FluidWorld */

/** 每 N tick 浮升一格。 */
const BUBBLE_PERIOD = 3

/**
 * 气区格中沿给定重力轴投影的极值格。
 * @param {number[]} cells 气区格索引
 * @param {number} W 世界宽
 * @param {{ n: number, dx: Int8Array, dy: Int8Array, w: Float32Array }} axis 重力轴权重
 * @param {boolean} [max=true] true → 最大投影
 * @returns {number} 极值格索引
 */
const extremeCell = (cells, W, axis, max = true) => {
	let best = cells[0]
	let bestScore = max ? -Infinity : Infinity
	for (const cell of cells) {
		const x = cell % W
		const y = (cell / W) | 0
		let score = 0
		for (let i = 0; i < axis.n; i++)
			score += axis.w[i] * (axis.dx[i] * x + axis.dy[i] * y)
		if (max ? score > bestScore : score < bestScore) {
			bestScore = score
			best = cell
		}
	}
	return best
}

/**
 * 推进熔岩内气泡。
 * @param {FluidWorld} world 世界
 * @returns {void}
 */
export const stepBubbles = (world) => {
	const step = world.soilStep | 0
	if (step % BUBBLE_PERIOD !== 0) return

	const { worldW: W, worldH: H, melt, regions, regionId } = world
	const up = gravityUpWeights(world)
	const down = gravityDownWeights(world)
	if (up.n <= 0) return
	let bestUp = 0
	for (let i = 1; i < up.n; i++)
		if (up.w[i] > up.w[bestUp]) bestUp = i
	const upDx = up.dx[bestUp]
	const upDy = up.dy[bestUp]

	/** @type {(number[] | undefined)[]} */
	const buckets = []
	for (let i = 0; i < W * H; i++) {
		const id = regionId[i]
		if (!id) continue
		;(buckets[id] ??= []).push(i)
	}

	for (let id = 1; id < regions.length; id++) {
		const region = regions[id]
		if (!region || region.openToAtm || region.airCells < BUBBLE_MIN_CELLS) continue
		const cells = buckets[id]
		if (!cells?.length) continue

		let meltNeighbors = 0
		for (const cell of cells) {
			const x = cell % W
			const y = (cell / W) | 0
			for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
				const nx = x + ox
				const ny = y + oy
				if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
				if (melt[ny * W + nx] >= LIQ_DRAW) meltNeighbors++
			}
		}
		if (meltNeighbors < BUBBLE_MIN_MELT_CONTACT) continue

		const shallow = extremeCell(cells, W, up)
		const tx = (shallow % W) + upDx
		const ty = ((shallow / W) | 0) + upDy
		if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue
		const target = ty * W + tx
		if (melt[target] < LIQ_DRAW) continue

		const deepest = extremeCell(cells, W, down)
		const mAmt = melt[target]
		const mTemp = world.temp[target]
		const deepAmt = melt[deepest]
		const deepTemp = world.temp[deepest]
		melt[target] = deepAmt
		world.temp[target] = deepTemp
		markAirIfMeltDrawCrossed(world, mAmt, deepAmt)
		melt[deepest] = mAmt
		world.temp[deepest] = mTemp
		markAirIfMeltDrawCrossed(world, deepAmt, mAmt)
		world.airDirty = true
		world.gasGeomDirty = true
	}
}
