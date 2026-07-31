/**
 * 土壤湿度 / 凝结 / 滴落。
 *
 * 吸收上方自由液体、土壤间渗流、天花板凝结、Matthew 邻格转移、COND_DRIP 滴落。
 * 由 `stepLiquid` 在水力均衡前调用。
 */

import {
	MAT, SOIL_CAP,
	SOIL_ABSORB_RATE, SOIL_SIDE_FRAC, SOIL_DOWN_FRAC, SOIL_CONDENSE_FRAC,
	COND_DRIP, COND_MATTHEW_RATE, COND_MATTHEW_NOISE,
	isSoilMat, isLiquidBarrier, soilAbsorbFactor,
} from './mat.mjs'
import {
	scratch, growScratch, addLiquid, markAirIfDrawCrossed,
} from './world.mjs'

/** @typedef {import('./world.mjs').FluidWorld} FluidWorld */

/**
 * 将 `moisture[cell]` 钳在 `[0, SOIL_CAP]`。
 * @param {Float32Array} moisture 土壤湿度场
 * @param {number} cell 扁平索引
 */
const clampMoisture = (moisture, cell) => {
	moisture[cell] = Math.min(SOIL_CAP, Math.max(0, moisture[cell]))
}

/**
 * 土壤渗流：吸收自由液体、共享湿度、供给凝结、Matthew 转移、滴落。
 * @param {FluidWorld} world 流体世界
 */
export const stepSoil = (world) => {
	const { worldW: W, worldH: H, mat, liq, moisture, condense } = world
	const n = W * H
	world.soilStep = (world.soilStep + 1) | 0
	const step = world.soilStep

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (!isSoilMat(mat[cell]) || y === 0) continue
			const above = (y - 1) * W + x
			if (isLiquidBarrier(mat[above]) || liq[above] <= 0) continue
			const room = SOIL_CAP - moisture[cell]
			if (room <= 0) continue
			const rate = SOIL_ABSORB_RATE * soilAbsorbFactor(moisture[cell])
			if (rate <= 1e-8) continue
			const before = liq[above]
			const take = Math.min(before, room, rate)
			liq[above] -= take
			moisture[cell] += take
			markAirIfDrawCrossed(world, before, liq[above])
		}

	let mvFrom = growScratch(world, 'mvFrom', 256, Int32Array)
	let mvTo = growScratch(world, 'mvTo', 256, Int32Array)
	let mvAmt = growScratch(world, 'mvAmt', 256, Float32Array)
	let feedFrom = growScratch(world, 'feedFrom', 64, Int32Array)
	let feedAmt = growScratch(world, 'feedAmt', 64, Float32Array)
	let mvN = 0
	let feedN = 0

	/**
	 * 排队土壤→土壤湿度转移。
	 * @param {number} from 源索引
	 * @param {number} to 目标索引
	 * @param {number} amt 质量
	 */
	const pushMv = (from, to, amt) => {
		if (mvN >= mvFrom.length) {
			mvFrom = growScratch(world, 'mvFrom', mvN + 1, Int32Array)
			mvTo = growScratch(world, 'mvTo', mvN + 1, Int32Array)
			mvAmt = growScratch(world, 'mvAmt', mvN + 1, Float32Array)
		}
		mvFrom[mvN] = from
		mvTo[mvN] = to
		mvAmt[mvN++] = amt
	}

	/**
	 * 排队土壤→凝结供给。
	 * @param {number} from 源索引
	 * @param {number} amt 质量
	 */
	const pushFeed = (from, amt) => {
		if (feedN >= feedFrom.length) {
			feedFrom = growScratch(world, 'feedFrom', feedN + 1, Int32Array)
			feedAmt = growScratch(world, 'feedAmt', feedN + 1, Float32Array)
		}
		feedFrom[feedN] = from
		feedAmt[feedN++] = amt
	}

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (!isSoilMat(mat[cell])) continue
			const m = moisture[cell]
			if (m <= 1e-8) continue

			if (y + 1 < H) {
				const below = (y + 1) * W + x
				if (isSoilMat(mat[below])) {
					const take = Math.min(m * SOIL_DOWN_FRAC, Math.max(0, SOIL_CAP - moisture[below]))
					if (take > 1e-8) pushMv(cell, below, take)
				}
				else if (mat[below] === MAT.AIR) {
					const take = m * SOIL_CONDENSE_FRAC
					if (take > 1e-8) pushFeed(cell, take)
				}
			}

			const left = x > 0 && isSoilMat(mat[cell - 1]) ? cell - 1 : -1
			const right = x + 1 < W && isSoilMat(mat[cell + 1]) ? cell + 1 : -1
			const sideN = (left >= 0 ? 1 : 0) + (right >= 0 ? 1 : 0)
			if (sideN) {
				const each = (m * SOIL_SIDE_FRAC) / sideN
				if (left >= 0) {
					const take = Math.min(each, Math.max(0, SOIL_CAP - moisture[left]))
					if (take > 1e-8) pushMv(cell, left, take)
				}
				if (right >= 0) {
					const take = Math.min(each, Math.max(0, SOIL_CAP - moisture[right]))
					if (take > 1e-8) pushMv(cell, right, take)
				}
			}
		}

	const outSum = scratch(world, 'soilOut', n, Float32Array)
	const inSum = scratch(world, 'soilIn', n, Float32Array)
	const delta = scratch(world, 'soilDelta', n, Float32Array)
	// Clear only touched indices — not the whole WH grid.
	for (let k = 0; k < mvN; k++) {
		outSum[mvFrom[k]] = 0
		outSum[mvTo[k]] = 0
		inSum[mvTo[k]] = 0
		delta[mvFrom[k]] = 0
		delta[mvTo[k]] = 0
	}
	for (let k = 0; k < feedN; k++) {
		outSum[feedFrom[k]] = 0
		delta[feedFrom[k]] = 0
	}

	for (let k = 0; k < mvN; k++) outSum[mvFrom[k]] += mvAmt[k]
	for (let k = 0; k < feedN; k++) outSum[feedFrom[k]] += feedAmt[k]
	for (let k = 0; k < mvN; k++) {
		const cap = moisture[mvFrom[k]]
		if (outSum[mvFrom[k]] > cap) mvAmt[k] *= cap / outSum[mvFrom[k]]
	}
	for (let k = 0; k < feedN; k++) {
		const cap = moisture[feedFrom[k]]
		if (outSum[feedFrom[k]] > cap) feedAmt[k] *= cap / outSum[feedFrom[k]]
	}

	for (let k = 0; k < mvN; k++) inSum[mvTo[k]] += mvAmt[k]
	for (let k = 0; k < mvN; k++) {
		const room = Math.max(0, SOIL_CAP - moisture[mvTo[k]])
		if (inSum[mvTo[k]] > room && inSum[mvTo[k]] > 1e-12)
			mvAmt[k] *= room / inSum[mvTo[k]]
	}

	for (let k = 0; k < mvN; k++) {
		delta[mvFrom[k]] -= mvAmt[k]
		delta[mvTo[k]] += mvAmt[k]
	}
	for (let k = 0; k < feedN; k++) {
		const from = feedFrom[k]
		const amt = feedAmt[k]
		delta[from] -= amt
		const below = from + W
		if (mat[below] === MAT.AIR) condense[from] += amt
		else delta[from] += amt
	}
	for (let k = 0; k < mvN; k++) {
		const cell = mvFrom[k]
		if (!delta[cell]) continue
		moisture[cell] += delta[cell]
		clampMoisture(moisture, cell)
		delta[cell] = 0
	}
	for (let k = 0; k < mvN; k++) {
		const cell = mvTo[k]
		if (!delta[cell]) continue
		moisture[cell] += delta[cell]
		clampMoisture(moisture, cell)
		delta[cell] = 0
	}
	for (let k = 0; k < feedN; k++) {
		const cell = feedFrom[k]
		if (!delta[cell]) continue
		moisture[cell] += delta[cell]
		clampMoisture(moisture, cell)
		delta[cell] = 0
	}

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W - 1; x++) {
			const cell = y * W + x
			const right = cell + 1
			if (!isSoilMat(mat[cell]) || !isSoilMat(mat[right])) continue
			const ca = condense[cell]
			const cb = condense[right]
			if (ca < 1e-8 || cb < 1e-8) continue
			const mass = ca + cb
			// Cheap LCG — Matthew only needs jitter, not cryptographic randomness.
			const noise = ((((cell * 374761393) ^ (right * 668265263) ^ (step * 1274126177)) >>> 0) / 4294967296 - 0.5)
				* COND_MATTHEW_NOISE * mass
			const bias = (ca - cb) + noise
			if (Math.abs(bias) < 1e-8) continue
			const rich = bias > 0 ? cell : right
			const poor = bias > 0 ? right : cell
			const take = Math.min(condense[poor] * COND_MATTHEW_RATE, Math.abs(bias) * COND_MATTHEW_RATE)
			if (take <= 1e-8) continue
			condense[poor] -= take
			condense[rich] += take
		}

	for (let y = 0; y < H - 1; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (!isSoilMat(mat[cell]) || condense[cell] < COND_DRIP) continue
			const below = (y + 1) * W + x
			if (mat[below] !== MAT.AIR) continue
			const amt = condense[cell]
			const added = addLiquid(world, x, y + 1, amt)
			condense[cell] = amt - added
		}
}
