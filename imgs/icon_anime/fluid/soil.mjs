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
 * 渗流队列 scratch（预分配 typed array，按 tick 复用）。
 * @typedef {object} SoilQueues
 * @property {Int32Array} moveSources 湿度转移源
 * @property {Int32Array} moveTargets 湿度转移目标
 * @property {Float32Array} moveAmounts 湿度转移量
 * @property {number} moveCount 湿度转移条数
 * @property {Int32Array} feedFrom 凝结供给源
 * @property {Float32Array} feedAmt 凝结供给量
 * @property {number} feedN 凝结供给条数
 */

/** @type {SoilQueues} */
const soilQueues = {
	moveSources: new Int32Array(0),
	moveTargets: new Int32Array(0),
	moveAmounts: new Float32Array(0),
	moveCount: 0,
	feedFrom: new Int32Array(0),
	feedAmt: new Float32Array(0),
	feedN: 0,
}

/**
 * 将 `moisture[cell]` 钳在 `[0, SOIL_CAP]`。
 * @param {Float32Array} moisture 土壤湿度场
 * @param {number} cell 扁平索引
 */
const clampMoisture = (moisture, cell) => {
	moisture[cell] = Math.min(SOIL_CAP, Math.max(0, moisture[cell]))
}

/**
 * 排队土壤→土壤湿度转移。
 * @param {FluidWorld} world 流体世界
 * @param {SoilQueues} queues 渗流队列
 * @param {number} from 源索引
 * @param {number} to 目标索引
 * @param {number} amount 质量
 */
const pushMove = (world, queues, from, to, amount) => {
	const { moveCount } = queues
	if (moveCount >= queues.moveSources.length) {
		queues.moveSources = growScratch(world, 'mvFrom', moveCount + 1, Int32Array)
		queues.moveTargets = growScratch(world, 'mvTo', moveCount + 1, Int32Array)
		queues.moveAmounts = growScratch(world, 'mvAmt', moveCount + 1, Float32Array)
	}
	queues.moveSources[moveCount] = from
	queues.moveTargets[moveCount] = to
	queues.moveAmounts[moveCount] = amount
	queues.moveCount = moveCount + 1
}

/**
 * 排队土壤→凝结供给。
 * @param {FluidWorld} world 流体世界
 * @param {SoilQueues} queues 渗流队列
 * @param {number} from 源索引
 * @param {number} amount 质量
 */
const pushFeed = (world, queues, from, amount) => {
	const { feedN } = queues
	if (feedN >= queues.feedFrom.length) {
		queues.feedFrom = growScratch(world, 'feedFrom', feedN + 1, Int32Array)
		queues.feedAmt = growScratch(world, 'feedAmt', feedN + 1, Float32Array)
	}
	queues.feedFrom[feedN] = from
	queues.feedAmt[feedN] = amount
	queues.feedN = feedN + 1
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

	/** @type {SoilQueues} */
	const queues = soilQueues
	queues.moveSources = growScratch(world, 'mvFrom', 256, Int32Array)
	queues.moveTargets = growScratch(world, 'mvTo', 256, Int32Array)
	queues.moveAmounts = growScratch(world, 'mvAmt', 256, Float32Array)
	queues.moveCount = 0
	queues.feedFrom = growScratch(world, 'feedFrom', 64, Int32Array)
	queues.feedAmt = growScratch(world, 'feedAmt', 64, Float32Array)
	queues.feedN = 0

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (!isSoilMat(mat[cell])) continue
			const moistureAmount = moisture[cell]
			if (moistureAmount <= 1e-8) continue

			if (y + 1 < H) {
				const below = (y + 1) * W + x
				if (isSoilMat(mat[below])) {
					const take = Math.min(moistureAmount * SOIL_DOWN_FRAC, Math.max(0, SOIL_CAP - moisture[below]))
					if (take > 1e-8) pushMove(world, queues, cell, below, take)
				}
				else if (mat[below] === MAT.AIR) {
					const take = moistureAmount * SOIL_CONDENSE_FRAC
					if (take > 1e-8) pushFeed(world, queues, cell, take)
				}
			}

			const left = x > 0 && isSoilMat(mat[cell - 1]) ? cell - 1 : -1
			const right = x + 1 < W && isSoilMat(mat[cell + 1]) ? cell + 1 : -1
			const sideCount = (left >= 0 ? 1 : 0) + (right >= 0 ? 1 : 0)
			if (sideCount) {
				const each = (moistureAmount * SOIL_SIDE_FRAC) / sideCount
				if (left >= 0) {
					const take = Math.min(each, Math.max(0, SOIL_CAP - moisture[left]))
					if (take > 1e-8) pushMove(world, queues, cell, left, take)
				}
				if (right >= 0) {
					const take = Math.min(each, Math.max(0, SOIL_CAP - moisture[right]))
					if (take > 1e-8) pushMove(world, queues, cell, right, take)
				}
			}
		}

	const { moveSources, moveTargets, moveAmounts, moveCount, feedFrom, feedAmt, feedN } = queues
	const outSum = scratch(world, 'soilOut', n, Float32Array)
	const inSum = scratch(world, 'soilIn', n, Float32Array)
	const delta = scratch(world, 'soilDelta', n, Float32Array)
	// Clear only touched indices — not the whole WH grid.
	for (let index = 0; index < moveCount; index++) {
		outSum[moveSources[index]] = 0
		outSum[moveTargets[index]] = 0
		inSum[moveTargets[index]] = 0
		delta[moveSources[index]] = 0
		delta[moveTargets[index]] = 0
	}
	for (let index = 0; index < feedN; index++) {
		outSum[feedFrom[index]] = 0
		delta[feedFrom[index]] = 0
	}

	for (let index = 0; index < moveCount; index++) outSum[moveSources[index]] += moveAmounts[index]
	for (let index = 0; index < feedN; index++) outSum[feedFrom[index]] += feedAmt[index]
	for (let index = 0; index < moveCount; index++) {
		const cap = moisture[moveSources[index]]
		if (outSum[moveSources[index]] > cap) moveAmounts[index] *= cap / outSum[moveSources[index]]
	}
	for (let index = 0; index < feedN; index++) {
		const cap = moisture[feedFrom[index]]
		if (outSum[feedFrom[index]] > cap) feedAmt[index] *= cap / outSum[feedFrom[index]]
	}

	for (let index = 0; index < moveCount; index++) inSum[moveTargets[index]] += moveAmounts[index]
	for (let index = 0; index < moveCount; index++) {
		const room = Math.max(0, SOIL_CAP - moisture[moveTargets[index]])
		if (inSum[moveTargets[index]] > room && inSum[moveTargets[index]] > 1e-12)
			moveAmounts[index] *= room / inSum[moveTargets[index]]
	}

	for (let index = 0; index < moveCount; index++) {
		delta[moveSources[index]] -= moveAmounts[index]
		delta[moveTargets[index]] += moveAmounts[index]
	}
	for (let index = 0; index < feedN; index++) {
		const from = feedFrom[index]
		const amount = feedAmt[index]
		delta[from] -= amount
		condense[from] += amount
	}
	/**
	 * 将 indices 上的 delta 合入 moisture 并钳制，清零已用格。
	 * @param {Int32Array} indices 单元索引
	 * @param {number} count 条数
	 */
	const applyDelta = (indices, count) => {
		for (let index = 0; index < count; index++) {
			const cell = indices[index]
			if (!delta[cell]) continue
			moisture[cell] += delta[cell]
			clampMoisture(moisture, cell)
			delta[cell] = 0
		}
	}
	applyDelta(moveSources, moveCount)
	applyDelta(moveTargets, moveCount)
	applyDelta(feedFrom, feedN)

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W - 1; x++) {
			const cell = y * W + x
			const right = cell + 1
			if (!isSoilMat(mat[cell]) || !isSoilMat(mat[right])) continue
			const leftCondense = condense[cell]
			const rightCondense = condense[right]
			if (leftCondense < 1e-8 || rightCondense < 1e-8) continue
			const mass = leftCondense + rightCondense
			// Cheap LCG — Matthew only needs jitter, not cryptographic randomness.
			const noise = ((((cell * 374761393) ^ (right * 668265263) ^ (step * 1274126177)) >>> 0) / 4294967296 - 0.5)
				* COND_MATTHEW_NOISE * mass
			const bias = (leftCondense - rightCondense) + noise
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
			const amount = condense[cell]
			const added = addLiquid(world, x, y + 1, amount)
			condense[cell] = amount - added
		}
}
