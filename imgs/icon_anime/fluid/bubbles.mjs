/**
 * 熔岩气泡：密闭气区在熔岩中沿 −ĝ 连续分数浮升，至自由面破裂。
 */

import { ORTHO_DX, ORTHO_DY } from '../hash.mjs'

import { viscGain } from './flow.mjs'
import { meltVisc } from './liquid/lava.mjs'
import {
	LIQ_DRAW, BUBBLE_MIN_CELLS, BUBBLE_MIN_MELT_CONTACT,
	SUBSTANCE, rhoOf, T_AMB,
} from './mat.mjs'
import { cellRho } from './thermal.mjs'
import { scratch, gravityUpWeights, markAirIfMeltDrawCrossed } from './world.mjs'

/** @typedef {import('./world.mjs').FluidWorld} FluidWorld */

/** 每 tick 气泡交换的基础速率（再乘 mobility / Δρ）。 */
const BUBBLE_RISE = 0.18
/** 单边交换上限。 */
const BUBBLE_CAP = 0.35

/**
 * 推进熔岩内气泡（分数质量交换，每 tick）。
 * @param {FluidWorld} world 世界
 * @returns {void}
 */
export const stepBubbles = (world) => {
	const { worldW: W, worldH: H, melt, regions, regionId, temp } = world
	const up = gravityUpWeights(world)
	if (up.n <= 0) return

	let bestUp = 0
	for (let i = 1; i < up.n; i++)
		if (up.w[i] > up.w[bestUp]) bestUp = i
	const upDx = up.dx[bestUp]
	const upDy = up.dy[bestUp]
	const upW = up.w[bestUp]
	if (upW < 0.15) return

	const n = W * H
	const nReg = regions.length
	const meltContact = scratch(world, 'bubbleMeltN', nReg, Int32Array)
	meltContact.fill(0)
	const seen = scratch(world, 'bubbleSeen', nReg, Uint8Array)
	seen.fill(0)

	for (let i = 0; i < n; i++) {
		const id = regionId[i]
		if (!id) continue
		const region = regions[id]
		if (!region || region.openToAtm || region.airCells < BUBBLE_MIN_CELLS) continue
		seen[id] = 1
		const x = i % W
		const y = (i / W) | 0
		for (let o = 0; o < 4; o++) {
			const nx = x + ORTHO_DX[o]
			const ny = y + ORTHO_DY[o]
			if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
			if (melt[ny * W + nx] >= LIQ_DRAW) meltContact[id]++
		}
	}

	const rhoAir = rhoOf(SUBSTANCE.AIR, T_AMB)

	for (let i = 0; i < n; i++) {
		const id = regionId[i]
		if (!id || !seen[id]) continue
		if (meltContact[id] < BUBBLE_MIN_MELT_CONTACT) continue
		const region = regions[id]
		if (!region || region.openToAtm) continue
		if (melt[i] >= LIQ_DRAW) continue

		const x = i % W
		const y = (i / W) | 0
		const tx = x + upDx
		const ty = y + upDy
		if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue
		const target = ty * W + tx
		if (melt[target] < LIQ_DRAW) continue

		const visc = meltVisc(world, target)
		const gain = viscGain(visc)
		if (gain <= 0) continue
		const rhoM = cellRho(world, target)
		const deltaRho = Math.max(0, rhoM - rhoAir)
		const flux = Math.min(
			BUBBLE_CAP,
			melt[target],
			BUBBLE_RISE * upW * gain * Math.min(1.5, deltaRho),
		)
		if (flux < 0.01) continue

		const mAmt = melt[target]
		const mTemp = temp[target]
		const deepAmt = melt[i]
		const deepTemp = temp[i]
		const take = Math.min(flux, mAmt)
		melt[target] = mAmt - take
		temp[target] = melt[target] > 1e-8 ? mTemp : T_AMB
		melt[i] = deepAmt + take
		temp[i] = melt[i] > 1e-8
			? (deepTemp * deepAmt + mTemp * take) / melt[i]
			: mTemp
		markAirIfMeltDrawCrossed(world, mAmt, melt[target])
		markAirIfMeltDrawCrossed(world, deepAmt, melt[i])
		world.airDirty = true
		world.gasGeomDirty = true
	}
}
