/**
 * 竞争式共演进：蓝队(tunables) vs 红队(attack genome) + 名人堂。
 */
import {
	mutateAttackGenome,
	normalizeAttackGenome,
	randomAttackGenome,
	updateAttackHallOfFame,
} from './attack_space.mjs'
import { pastDeadline } from './duration.mjs'
import { evaluateTunablesAgainstAttacks, minPanelFitness } from './metrics.mjs'
import { runSimulation } from './model.mjs'
import { computeProgressPercent } from './optimizer.mjs'
import { createRng } from './rng.mjs'
import { mutateCandidate, randomCandidate } from './space.mjs'
import { loadDefaultTunables } from './tunables_bundle.mjs'

/**
 * @typedef {{
 *   tunables: import('./tunables_bundle.mjs').TunablesBundle,
 *   attackGenome: import('./attack_space.mjs').AttackGenome,
 *   result: Awaited<ReturnType<typeof evaluateTunablesAgainstAttacks>>,
 *   generation: number,
 * }} CoevoCandidate
 */

/**
 * @param {object} opts 选项
 * @param {import('./scenarios.mjs').SimScenario[]} opts.scenarios 场景
 * @param {number} [opts.generations=20] 代数
 * @param {number} [opts.population=12] 蓝队种群
 * @param {number} [opts.redPopulation=8] 红队种群
 * @param {number[]} [opts.seeds] 种子
 * @param {number} [opts.seedBase=42] 搜索种子基
 * @param {import('./metrics.mjs').MetricWeights} [opts.weights] 权重
 * @param {number | null} [opts.durationMs] 时长上限
 * @param {(info: import('./optimizer.mjs').OptimizerProgress) => void} [opts.onProgress] 进度
 * @returns {Promise<object>} 共演进结果
 */
export async function runCoevolution(opts) {
	const {
		scenarios,
		generations = 20,
		population = 12,
		redPopulation = 8,
		seeds = [1, 2, 3],
		seedBase = 42,
		weights,
		durationMs = null,
		onProgress,
	} = opts

	const startedAt = Date.now()
	const deadline = durationMs != null && durationMs > 0 ? startedAt + durationMs : null
	const timed = deadline != null

	const baselineTunables = loadDefaultTunables()
	const baselineAttack = normalizeAttackGenome(undefined)
	const baselineEval = await evaluateTunablesAgainstAttacks(
		scenarios, seeds, baselineTunables, [baselineAttack], runSimulation, weights,
	)
	const baseline = { tunables: baselineTunables, attackGenome: baselineAttack, result: baselineEval, generation: 0 }

	let bestBlue = { ...baseline }
	let bestRed = {
		tunables: baselineTunables,
		attackGenome: randomAttackGenome(() => Math.random()),
		result: baselineEval,
		generation: 0,
	}

	/** @type {Array<{ genome: import('./attack_space.mjs').AttackGenome, fitness: number }>} */
	let attackHof = []
	/** @type {CoevoCandidate[]} */
	let bluePool = [{ ...baseline }]
	for (let i = 1; i < population; i++) {
		const tunables = randomCandidate(seedBase + i)
		const result = await evaluateTunablesAgainstAttacks(
			scenarios, seeds, tunables, [baselineAttack, ...attackHof.map(h => h.genome)], runSimulation, weights,
		)
		bluePool.push({ tunables, attackGenome: baselineAttack, result, generation: 0 })
		if (result.fitness > bestBlue.result.fitness) bestBlue = bluePool[bluePool.length - 1]
	}

	/** @type {CoevoCandidate[]} */
	let redPool = []
	for (let i = 0; i < redPopulation; i++) {
		const attackGenome = randomAttackGenome(createRng(seedBase + 500 + i))
		const harm = await evaluateRedFitness(scenarios, seeds, bestBlue.tunables, attackGenome, weights)
		redPool.push({ tunables: bestBlue.tunables, attackGenome, result: harm, generation: 0 })
		attackHof = updateAttackHallOfFame(attackHof, attackGenome, -harm.fitness)
		if (-harm.fitness > -bestRed.result.fitness) bestRed = redPool[redPool.length - 1]
	}

	/** @type {Array<{ generation: number, bestFitness: number, meanFitness: number, bestRedHarm: number }>} */
	const history = [{
		generation: 0,
		bestFitness: bestBlue.result.fitness,
		meanFitness: bluePool.reduce((s, c) => s + c.result.fitness, 0) / bluePool.length,
		bestRedHarm: -bestRed.result.fitness,
	}]

	let gen = 1
	let generationsRun = 0
	while (true) {
		if (!timed && gen > generations) break
		if (timed && pastDeadline(deadline)) break

		const attackPanel = [...attackHof.map(h => h.genome), ...redPool.slice(0, 3).map(r => r.attackGenome)]

		bluePool.sort((a, b) => b.result.fitness - a.result.fitness)
		const blueElites = bluePool.slice(0, Math.max(2, Math.floor(population / 4)))
		/** @type {CoevoCandidate[]} */
		const nextBlue = [...blueElites]
		while (nextBlue.length < population) {
			const parent = blueElites[nextBlue.length % blueElites.length]
			const tunables = mutateCandidate(parent.tunables, seedBase + gen * 1000 + nextBlue.length)
			const result = await evaluateTunablesAgainstAttacks(
				scenarios, seeds, tunables, attackPanel, runSimulation, weights,
			)
			const rec = { tunables, attackGenome: parent.attackGenome, result, generation: gen }
			nextBlue.push(rec)
			if (result.fitness > bestBlue.result.fitness) bestBlue = rec
		}
		bluePool = nextBlue

		redPool.sort((a, b) => a.result.fitness - b.result.fitness)
		const redElites = redPool.slice(0, Math.max(2, Math.floor(redPopulation / 3)))
		/** @type {CoevoCandidate[]} */
		const nextRed = [...redElites]
		while (nextRed.length < redPopulation) {
			const parent = redElites[nextRed.length % redElites.length]
			const attackGenome = mutateAttackGenome(parent.attackGenome, seedBase + gen * 2000 + nextRed.length)
			const harm = await evaluateRedFitness(scenarios, seeds, bestBlue.tunables, attackGenome, weights)
			const rec = { tunables: bestBlue.tunables, attackGenome, result: harm, generation: gen }
			nextRed.push(rec)
			attackHof = updateAttackHallOfFame(attackHof, attackGenome, -harm.fitness)
			if (-harm.fitness > -bestRed.result.fitness) bestRed = rec
		}
		redPool = nextRed

		generationsRun = gen
		history.push({
			generation: gen,
			bestFitness: bestBlue.result.fitness,
			meanFitness: bluePool.reduce((s, c) => s + c.result.fitness, 0) / bluePool.length,
			bestRedHarm: -bestRed.result.fitness,
		})
		if (onProgress) 
			onProgress({
				generation: gen,
				generationsRun,
				bestFitness: bestBlue.result.fitness,
				meanFitness: history[history.length - 1].meanFitness,
				elapsedMs: Date.now() - startedAt,
				durationMs,
				generations,
				percent: computeProgressPercent(durationMs, generations, gen, Date.now() - startedAt, timed),
			})
		
		gen++
	}

	return {
		baseline,
		best: bestBlue,
		bestRed,
		attackHof,
		history,
		stoppedBy: timed && pastDeadline(deadline) ? 'duration' : 'generations',
		generationsRun,
		durationMs,
		elapsedMs: Date.now() - startedAt,
	}
}

/**
 * @param {import('./scenarios.mjs').SimScenario[]} scenarios 场景
 * @param {number[]} seeds 种子
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 蓝队
 * @param {import('./attack_space.mjs').AttackGenome} attackGenome 红队
 * @param {import('./metrics.mjs').MetricWeights} [weights] 权重
 * @returns {Promise<Awaited<ReturnType<typeof evaluateTunablesAgainstAttacks>>>} 红队适应度（越低=伤害越大）
 */
async function evaluateRedFitness(scenarios, seeds, tunables, attackGenome, weights) {
	const evalResult = await evaluateTunablesAgainstAttacks(
		scenarios, seeds, tunables, [attackGenome], runSimulation, weights,
	)
	return { ...evalResult, fitness: 1 - evalResult.fitness }
}

void minPanelFitness
