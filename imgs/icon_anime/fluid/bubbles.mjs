/**
 * 熔岩气泡：密闭气区在熔岩中沿 −ĝ 浮升，至自由面破裂。
 */

import { LIQ_DRAW, BUBBLE_MIN_CELLS } from './mat.mjs'
import { gravityDownStep, markAirIfMeltDrawCrossed } from './world.mjs'

/** @typedef {import('./world.mjs').FluidWorld} FluidWorld */

/** 每 N tick 浮升一格。 */
const BUBBLE_PERIOD = 3

/**
 * 推进熔岩内气泡。
 * @param {FluidWorld} world 世界
 * @returns {void}
 */
export const stepBubbles = (world) => {
	const step = (world.soilStep | 0)
	if (step % BUBBLE_PERIOD !== 0) return

	const { worldW: W, worldH: H, melt, regions, regionId } = world
	const { dx, dy } = gravityDownStep(world)
	const upDx = -dx
	const upDy = -dy

	for (let id = 1; id < regions.length; id++) {
		const region = regions[id]
		if (!region || region.openToAtm || region.airCells < BUBBLE_MIN_CELLS) continue

		/** @type {number[]} */
		const cells = []
		for (let i = 0; i < W * H; i++)
			if (regionId[i] === id) cells.push(i)
		if (!cells.length) continue

		// Only rise if surrounded / capped by melt in the down direction somewhere.
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
		if (meltNeighbors < BUBBLE_MIN_CELLS) continue

		// Try shift whole bubble one step up: swap with melt above centroid.
		let sumX = 0
		let sumY = 0
		for (const cell of cells) {
			sumX += cell % W
			sumY += (cell / W) | 0
		}
		const cx = (sumX / cells.length) | 0
		const cy = (sumY / cells.length) | 0
		const tx = cx + upDx
		const ty = cy + upDy
		if (tx < 0 || ty < 0 || tx >= W || ty >= H) {
			// Reached up edge / free surface — rupture: clear is automatic via open air.
			continue
		}
		const target = ty * W + tx
		if (melt[target] < LIQ_DRAW) continue

		// Swap one melt cell into the deepest bubble cell.
		let deepest = cells[0]
		let deepScore = -Infinity
		for (const cell of cells) {
			const x = cell % W
			const y = (cell / W) | 0
			const score = dx * x + dy * y
			if (score > deepScore) {
				deepScore = score
				deepest = cell
			}
		}
		const mAmt = melt[target]
		const mTemp = world.temp[target]
		const beforeDeep = melt[deepest]
		melt[target] = 0
		world.temp[target] = 0
		markAirIfMeltDrawCrossed(world, mAmt, 0)
		melt[deepest] = mAmt
		world.temp[deepest] = mTemp
		markAirIfMeltDrawCrossed(world, beforeDeep, mAmt)
		world.airDirty = true
		world.gasGeomDirty = true
	}
}
