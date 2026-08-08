/**
 * 熔岩气泡：密闭气区在熔岩中沿 −ĝ 浮升，至自由面破裂。
 */

import { ORTHO_DX, ORTHO_DY } from '../hash.mjs'

import { LIQ_DRAW, BUBBLE_MIN_CELLS, BUBBLE_MIN_MELT_CONTACT } from './mat.mjs'
import { scratch, gravityUpWeights, gravityDownWeights, markAirIfMeltDrawCrossed } from './world.mjs'

/** @typedef {import('./world.mjs').FluidWorld} FluidWorld */

/** 每 N tick 浮升一格。 */
const BUBBLE_PERIOD = 3

/**
 * 推进熔岩内气泡。
 * 单遍扫描：每气区只跟踪沿 ±ĝ 的极值格与熔岩接触数（无 per-region JS 数组）。
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

	const nReg = regions.length
	if (nReg <= 1) return

	const shallowCell = scratch(world, 'bubbleShallow', nReg, Int32Array)
	const deepCell = scratch(world, 'bubbleDeep', nReg, Int32Array)
	const shallowScore = scratch(world, 'bubbleShallowSc', nReg, Float32Array)
	const deepScore = scratch(world, 'bubbleDeepSc', nReg, Float32Array)
	const meltContact = scratch(world, 'bubbleMeltN', nReg, Int32Array)
	const seen = scratch(world, 'bubbleSeen', nReg, Uint8Array)
	shallowCell.fill(-1)
	deepCell.fill(-1)
	shallowScore.fill(-Infinity)
	deepScore.fill(-Infinity)
	meltContact.fill(0)
	seen.fill(0)

	const n = W * H
	for (let i = 0; i < n; i++) {
		const id = regionId[i]
		if (!id) continue
		const region = regions[id]
		if (!region || region.openToAtm || region.airCells < BUBBLE_MIN_CELLS) continue
		seen[id] = 1
		const x = i % W
		const y = (i / W) | 0
		let upSc = 0
		for (let k = 0; k < up.n; k++)
			upSc += up.w[k] * (up.dx[k] * x + up.dy[k] * y)
		if (upSc > shallowScore[id]) {
			shallowScore[id] = upSc
			shallowCell[id] = i
		}
		let downSc = 0
		for (let k = 0; k < down.n; k++)
			downSc += down.w[k] * (down.dx[k] * x + down.dy[k] * y)
		if (downSc > deepScore[id]) {
			deepScore[id] = downSc
			deepCell[id] = i
		}
		for (let o = 0; o < 4; o++) {
			const nx = x + ORTHO_DX[o]
			const ny = y + ORTHO_DY[o]
			if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
			if (melt[ny * W + nx] >= LIQ_DRAW) meltContact[id]++
		}
	}

	let bestUp = 0
	for (let i = 1; i < up.n; i++)
		if (up.w[i] > up.w[bestUp]) bestUp = i
	const upDx = up.dx[bestUp]
	const upDy = up.dy[bestUp]

	for (let id = 1; id < nReg; id++) {
		if (!seen[id]) continue
		if (meltContact[id] < BUBBLE_MIN_MELT_CONTACT) continue
		const shallow = shallowCell[id]
		const deepest = deepCell[id]
		if (shallow < 0 || deepest < 0) continue

		const tx = (shallow % W) + upDx
		const ty = ((shallow / W) | 0) + upDy
		if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue
		const target = ty * W + tx
		if (melt[target] < LIQ_DRAW) continue

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
