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
import { evaluateManyAgainstAttacks, evaluateTunablesAgainstAttacks, minPanelFitness } from './metrics.mjs'
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
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 蓝队参数
 * @param {import('./attack_space.mjs').AttackGenome[]} attackGenomes 红队基因组
 * @returns {import('./metrics.mjs').EvalCandidate[]} 单基因组候选
 */
function redEvalCandidates(tunables, attackGenomes) {
	return attackGenomes.map(attackGenome => ({
		tunables,
		attackPanel: [attackGenome],
	}))
}

/**
 * @param {Awaited<ReturnType<typeof evaluateManyAgainstAttacks>>} results 蓝队评估
 * @returns {Awaited<ReturnType<typeof evaluateTunablesAgainstAttacks>>[]} 红队伤害评估
 */
function toRedHarmResults(results) {
	return results.map(r => ({ ...r, fitness: 1 - r.fitness }))
}

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
 * @param {import('./metrics.mjs').EvalOpts} [opts.evalOpts] 评估并行选项
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
		evalOpts,
		onProgress,
	} = opts

	const startedAt = Date.now()
	const deadline = durationMs != null && durationMs > 0 ? startedAt + durationMs : null
	const timed = deadline != null

	const baselineTunables = loadDefaultTunables()
	const baselineAttack = normalizeAttackGenome(undefined)
	const baselineEval = await evaluateTunablesAgainstAttacks(
		scenarios, seeds, baselineTunables, [baselineAttack], runSimulation, weights, evalOpts,
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

	const initBluePanel = [baselineAttack, ...attackHof.map(h => h.genome)]
	const initBlueCandidates = []
	for (let i = 1; i < population; i++)
		initBlueCandidates.push({ tunables: randomCandidate(seedBase + i), attackPanel: initBluePanel })

	if (initBlueCandidates.length) {
		const initBlueResults = await evaluateManyAgainstAttacks(
			scenarios, seeds, initBlueCandidates, runSimulation, weights, evalOpts,
		)
		for (let i = 0; i < initBlueResults.length; i++) {
			const rec = {
				tunables: initBlueCandidates[i].tunables,
				attackGenome: baselineAttack,
				result: initBlueResults[i],
				generation: 0,
			}
			bluePool.push(rec)
			if (initBlueResults[i].fitness > bestBlue.result.fitness) bestBlue = rec
		}
	}

	/** @type {CoevoCandidate[]} */
	let redPool = []
	const initRedGenomes = []
	for (let i = 0; i < redPopulation; i++)
		initRedGenomes.push(randomAttackGenome(createRng(seedBase + 500 + i)))

	const initRedResults = toRedHarmResults(await evaluateManyAgainstAttacks(
		scenarios, seeds, redEvalCandidates(bestBlue.tunables, initRedGenomes), runSimulation, weights, evalOpts,
	))
	for (let i = 0; i < initRedResults.length; i++) {
		const attackGenome = initRedGenomes[i]
		const rec = { tunables: bestBlue.tunables, attackGenome, result: initRedResults[i], generation: 0 }
		redPool.push(rec)
		attackHof = updateAttackHallOfFame(attackHof, attackGenome, -initRedResults[i].fitness)
		if (-initRedResults[i].fitness > -bestRed.result.fitness) bestRed = rec
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
		/** @type {Array<{ parent: CoevoCandidate, tunables: import('./tunables_bundle.mjs').TunablesBundle }>} */
		const blueMutations = []
		const blueOffspring = population - nextBlue.length
		while (blueMutations.length < blueOffspring) {
			const parent = blueElites[blueMutations.length % blueElites.length]
			blueMutations.push({
				parent,
				tunables: mutateCandidate(parent.tunables, seedBase + gen * 1000 + nextBlue.length + blueMutations.length),
			})
		}
		if (blueMutations.length) {
			const blueBatch = blueMutations.map(m => ({ tunables: m.tunables, attackPanel }))
			const blueResults = await evaluateManyAgainstAttacks(
				scenarios, seeds, blueBatch, runSimulation, weights, evalOpts,
			)
			for (let i = 0; i < blueResults.length; i++) {
				const rec = {
					tunables: blueMutations[i].tunables,
					attackGenome: blueMutations[i].parent.attackGenome,
					result: blueResults[i],
					generation: gen,
				}
				nextBlue.push(rec)
				if (blueResults[i].fitness > bestBlue.result.fitness) bestBlue = rec
			}
		}
		bluePool = nextBlue

		redPool.sort((a, b) => a.result.fitness - b.result.fitness)
		const redElites = redPool.slice(0, Math.max(2, Math.floor(redPopulation / 3)))
		/** @type {CoevoCandidate[]} */
		const nextRed = [...redElites]
		/** @type {import('./attack_space.mjs').AttackGenome[]} */
		const redMutations = []
		const redOffspring = redPopulation - nextRed.length
		while (redMutations.length < redOffspring) {
			const parent = redElites[redMutations.length % redElites.length]
			redMutations.push(mutateAttackGenome(parent.attackGenome, seedBase + gen * 2000 + nextRed.length + redMutations.length))
		}
		if (redMutations.length) {
			const redResults = toRedHarmResults(await evaluateManyAgainstAttacks(
				scenarios, seeds, redEvalCandidates(bestBlue.tunables, redMutations), runSimulation, weights, evalOpts,
			))
			for (let i = 0; i < redResults.length; i++) {
				const attackGenome = redMutations[i]
				const rec = { tunables: bestBlue.tunables, attackGenome, result: redResults[i], generation: gen }
				nextRed.push(rec)
				attackHof = updateAttackHallOfFame(attackHof, attackGenome, -redResults[i].fitness)
				if (-redResults[i].fitness > -bestRed.result.fitness) bestRed = rec
			}
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

void minPanelFitness
