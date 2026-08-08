/**
 * 土壤湿度 / 凝结 / 滴落。
 *
 * 吸收上方自由液体、土壤间渗流、天花板凝结、Matthew 邻格转移、COND_DRIP 滴落。
 * 凝结膜挂在重力下沿；ĝ 转离开放下沿时收回水分。由 `stepLiquid` 在水力均衡前调用。
 */

import { ORTHO_DX, ORTHO_DY } from '../hash.mjs'

import {
	MAT, SOIL_CAP,
	SOIL_ABSORB_RATE, SOIL_SIDE_FRAC, SOIL_DOWN_FRAC, SOIL_CONDENSE_FRAC,
	COND_DRAW, COND_DRIP, COND_WEEP_FRAC, COND_MATTHEW_RATE, COND_MATTHEW_NOISE,
	isSoilMat, isLiquidBarrier, soilAbsorbFactor,
} from './mat.mjs'
import {
	scratch, growScratch, addLiquid, markAirIfDrawCrossed,
	gravityDownWeights, gravityUpWeights, strongestDown, inWorld,
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
 * 空气格是否应显示来自重力上方土壤的悬挂凝结。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {{ dx: number[], dy: number[], w: number[], n: number }} [up] 上向权重（复用）
 * @returns {number} 土壤格索引，无则 -1
 */
export const condenseDripSource = (world, x, y, up = gravityUpWeights(world)) => {
	const { mat, condense, worldW } = world
	for (let offsetIndex = 0; offsetIndex < up.n; offsetIndex++) {
		const soilX = x + up.dx[offsetIndex]
		const soilY = y + up.dy[offsetIndex]
		if (!inWorld(world, soilX, soilY)) continue
		const soil = soilY * worldW + soilX
		if (isSoilMat(mat[soil]) && condense[soil] >= COND_DRAW) return soil
	}
	return -1
}

/**
 * 重力下沿是否仍为开放空气（悬挂凝结的附着面）。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {{ dx: number[], dy: number[], w: number[], n: number }} down 下向权重
 * @returns {boolean} 是否开放
 */
const hasOpenUnderside = (world, x, y, down) => {
	const { mat, worldW } = world
	for (let offsetIndex = 0; offsetIndex < down.n; offsetIndex++) {
		const belowX = x + down.dx[offsetIndex]
		const belowY = y + down.dy[offsetIndex]
		if (!inWorld(world, belowX, belowY)) continue
		if (mat[belowY * worldW + belowX] === MAT.AIR) return true
	}
	return false
}

/**
 * 将多余质量溢到邻接空气（按下向权重分配，再任意正交）。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} amount 质量
 * @param {{ dx: number[], dy: number[], w: number[], n: number }} down 下向权重
 * @returns {number} 实际写入量
 */
const spillToAir = (world, x, y, amount, down) => {
	if (amount <= 1e-8) return 0
	let written = 0
	let weightSum = 0
	for (let offsetIndex = 0; offsetIndex < down.n; offsetIndex++) {
		const belowX = x + down.dx[offsetIndex]
		const belowY = y + down.dy[offsetIndex]
		if (!inWorld(world, belowX, belowY)) continue
		if (world.mat[belowY * world.worldW + belowX] !== MAT.AIR) continue
		weightSum += down.w[offsetIndex]
	}
	if (weightSum > 1e-8)
		for (let offsetIndex = 0; offsetIndex < down.n; offsetIndex++) {
			const belowX = x + down.dx[offsetIndex]
			const belowY = y + down.dy[offsetIndex]
			if (!inWorld(world, belowX, belowY)) continue
			if (world.mat[belowY * world.worldW + belowX] !== MAT.AIR) continue
			written += addLiquid(world, belowX, belowY, amount * (down.w[offsetIndex] / weightSum))
		}
	let rest = amount - written
	if (rest <= 1e-8) return written
	for (let i = 0; i < 4; i++) {
		const neighborX = x + ORTHO_DX[i]
		const neighborY = y + ORTHO_DY[i]
		if (!inWorld(world, neighborX, neighborY)) continue
		if (world.mat[neighborY * world.worldW + neighborX] !== MAT.AIR) continue
		const got = addLiquid(world, neighborX, neighborY, rest)
		written += got
		rest -= got
		if (rest <= 1e-8) break
	}
	return written
}

/**
 * 土壤渗流：吸收自由液体、共享湿度、供给凝结、Matthew 转移、滴落、收回。
 * @param {FluidWorld} world 流体世界
 */
export const stepSoil = (world) => {
	const { worldW: W, worldH: H, mat, liq, moisture, condense } = world
	const n = W * H
	world.soilStep = (world.soilStep + 1) | 0
	const step = world.soilStep
	const up = gravityUpWeights(world)
	const down = gravityDownWeights(world)
	const strongDown = strongestDown(world)
	let sideA = { dx: -1, dy: 0 }
	let sideB = { dx: 1, dy: 0 }
	if (strongDown.w > 0 && strongDown.dx !== 0) {
		sideA = { dx: 0, dy: -1 }
		sideB = { dx: 0, dy: 1 }
	}

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (!isSoilMat(mat[cell])) continue
			for (let i = 0; i < up.n; i++) {
				if (up.w[i] < 0.5) continue
				const ax = x + up.dx[i]
				const ay = y + up.dy[i]
				if (!inWorld(world, ax, ay)) continue
				const above = ay * W + ax
				if (isLiquidBarrier(mat[above]) || liq[above] <= 0) continue
				const room = SOIL_CAP - moisture[cell]
				if (room <= 0) continue
				const rate = SOIL_ABSORB_RATE * soilAbsorbFactor(moisture[cell]) * up.w[i]
				if (rate <= 1e-8) continue
				const before = liq[above]
				const take = Math.min(before, room, rate)
				liq[above] -= take
				moisture[cell] += take
				markAirIfDrawCrossed(world, before, liq[above])
			}
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

			for (let i = 0; i < down.n; i++) {
				const bx = x + down.dx[i]
				const by = y + down.dy[i]
				if (!inWorld(world, bx, by)) continue
				const below = by * W + bx
				const w = down.w[i]
				if (isSoilMat(mat[below])) {
					const take = Math.min(moistureAmount * SOIL_DOWN_FRAC * w, Math.max(0, SOIL_CAP - moisture[below]))
					if (take > 1e-8) pushMove(world, queues, cell, below, take)
				}
				else if (mat[below] === MAT.AIR) {
					const take = moistureAmount * SOIL_CONDENSE_FRAC * w
					if (take > 1e-8) pushFeed(world, queues, cell, take)
				}
			}

			let side0 = -1
			let side1 = -1
			let sideN = 0
			for (const side of [sideA, sideB]) {
				const sx = x + side.dx
				const sy = y + side.dy
				if (!inWorld(world, sx, sy)) continue
				const neighbor = sy * W + sx
				if (!isSoilMat(mat[neighbor])) continue
				if (sideN === 0) side0 = neighbor
				else side1 = neighbor
				sideN++
			}
			if (sideN) {
				const each = (moistureAmount * SOIL_SIDE_FRAC) / sideN
				for (let si = 0; si < sideN; si++) {
					const neighbor = si === 0 ? side0 : side1
					const take = Math.min(each, Math.max(0, SOIL_CAP - moisture[neighbor]))
					if (take > 1e-8) pushMove(world, queues, cell, neighbor, take)
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

	// Matthew along gravity-perpendicular (sideB is the +1 direction of the pair).
	const sideDx = sideB.dx
	const sideDy = sideB.dy
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const nx = x + sideDx
			const ny = y + sideDy
			if (!inWorld(world, nx, ny)) continue
			const cell = y * W + x
			const other = ny * W + nx
			if (!isSoilMat(mat[cell]) || !isSoilMat(mat[other])) continue
			const leftCondense = condense[cell]
			const rightCondense = condense[other]
			if (leftCondense < 1e-8 || rightCondense < 1e-8) continue
			const mass = leftCondense + rightCondense
			const noise = ((((cell * 374761393) ^ (other * 668265263) ^ (step * 1274126177)) >>> 0) / 4294967296 - 0.5)
				* COND_MATTHEW_NOISE * mass
			const bias = (leftCondense - rightCondense) + noise
			if (Math.abs(bias) < 1e-8) continue
			const rich = bias > 0 ? cell : other
			const poor = bias > 0 ? other : cell
			const take = Math.min(condense[poor] * COND_MATTHEW_RATE, Math.abs(bias) * COND_MATTHEW_RATE)
			if (take <= 1e-8) continue
			condense[poor] -= take
			condense[rich] += take
		}

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (!isSoilMat(mat[cell]) || condense[cell] <= 1e-8) continue
			let weightSum = 0
			for (let offsetIndex = 0; offsetIndex < down.n; offsetIndex++) {
				const belowX = x + down.dx[offsetIndex]
				const belowY = y + down.dy[offsetIndex]
				if (!inWorld(world, belowX, belowY)) continue
				if (mat[belowY * W + belowX] !== MAT.AIR) continue
				weightSum += down.w[offsetIndex]
			}
			if (weightSum <= 1e-8) continue
			const held = condense[cell]
			const amount = held >= COND_DRIP ? held : held * COND_WEEP_FRAC
			if (amount <= 1e-8) continue
			let written = 0
			for (let offsetIndex = 0; offsetIndex < down.n; offsetIndex++) {
				const belowX = x + down.dx[offsetIndex]
				const belowY = y + down.dy[offsetIndex]
				if (!inWorld(world, belowX, belowY)) continue
				if (mat[belowY * W + belowX] !== MAT.AIR) continue
				written += addLiquid(world, belowX, belowY, amount * (down.w[offsetIndex] / weightSum))
			}
			condense[cell] = held - written
		}

	// ĝ 转离开放下沿 → 悬挂凝结收回（回潮，满则溢到邻接空气；溢不完留在 condense）。
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (!isSoilMat(mat[cell]) || condense[cell] <= 1e-8) continue
			if (hasOpenUnderside(world, x, y, down)) continue
			const back = condense[cell]
			const room = Math.max(0, SOIL_CAP - moisture[cell])
			const toMoist = Math.min(back, room)
			moisture[cell] += toMoist
			const rest = back - toMoist
			const spilled = rest > 1e-8 ? spillToAir(world, x, y, rest, down) : 0
			condense[cell] = rest - spilled
		}
}
