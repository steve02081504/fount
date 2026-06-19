/**
 * 参数搜索（随机 + 进化）。
 */
import { pastDeadline } from './duration.mjs'
import { evaluateTunables } from './metrics.mjs'
import { runSimulation } from './model.mjs'
import { mutateCandidate, randomCandidate } from './space.mjs'
import { loadDefaultTunables } from './tunables_bundle.mjs'

/**
 * @typedef {{
 *   tunables: import('./tunables_bundle.mjs').TunablesBundle,
 *   result: Awaited<ReturnType<typeof evaluateTunables>>,
 *   generation: number,
 * }} CandidateRecord
 */

/**
 * @typedef {{
 *   baseline: CandidateRecord,
 *   best: CandidateRecord,
 *   history: Array<{ generation: number, bestFitness: number, meanFitness: number }>,
 *   stoppedBy: 'generations' | 'duration',
 *   generationsRun: number,
 *   durationMs: number | null,
 *   elapsedMs: number,
 * }} OptimizerResult
 */

/**
 * @param {CandidateRecord[]} pool 当前种群
 * @param {CandidateRecord} best 当前最优
 * @param {number} generation 代数
 * @returns {{ pool: CandidateRecord[], best: CandidateRecord, meanFitness: number }} 本代统计
 */
function recordGeneration(pool, best, generation) {
	const meanFitness = pool.reduce((s, c) => s + c.result.fitness, 0) / pool.length
	return { pool, best, meanFitness }
}

/**
 * @param {object} opts 选项
 * @param {import('./scenarios.mjs').SimScenario[]} opts.scenarios 场景
 * @param {number} [opts.generations=20] 代数上限（未设 duration 时生效）
 * @param {number} [opts.population=12] 种群
 * @param {number[]} [opts.seeds] 种子
 * @param {number} [opts.seedBase=42] 搜索种子基
 * @param {import('./metrics.mjs').MetricWeights} [opts.weights] 权重
 * @param {number | null} [opts.durationMs] 墙钟时长上限（毫秒）；设则按时间停止
 * @returns {Promise<OptimizerResult>} 搜索结论
 */
export async function runOptimizer(opts) {
	const {
		scenarios,
		generations = 20,
		population = 12,
		seeds = [1, 2, 3],
		seedBase = 42,
		weights,
		durationMs = null,
	} = opts

	const startedAt = Date.now()
	const deadline = durationMs != null && durationMs > 0 ? startedAt + durationMs : null
	const timed = deadline != null

	const baselineTunables = loadDefaultTunables()
	const baselineResult = await evaluateTunables(scenarios, seeds, baselineTunables, runSimulation, weights)
	const baseline = { tunables: baselineTunables, result: baselineResult, generation: 0 }

	/** @type {CandidateRecord} */
	let best = { ...baseline }
	/** @type {Array<{ generation: number, bestFitness: number, meanFitness: number }>} */
	const history = []

	/** @type {CandidateRecord[]} */
	let pool = [{ ...baseline }]
	for (let i = 1; i < population; i++) {
		const tunables = randomCandidate(seedBase + i)
		const result = await evaluateTunables(scenarios, seeds, tunables, runSimulation, weights)
		const rec = { tunables, result, generation: 0 }
		pool.push(rec)
		if (result.fitness > best.result.fitness) best = rec
	}

	{
		const snap = recordGeneration(pool, best, 0)
		history.push({
			generation: 0,
			bestFitness: best.result.fitness,
			meanFitness: snap.meanFitness,
		})
	}

	/** @type {'generations' | 'duration'} */
	let stoppedBy = timed ? 'duration' : 'generations'
	let generationsRun = 0

	if (timed && pastDeadline(deadline)) 
		return {
			baseline,
			best,
			history,
			stoppedBy: 'duration',
			generationsRun: 0,
			durationMs,
			elapsedMs: Date.now() - startedAt,
		}
	

	let gen = 1
	while (true) {
		if (!timed && gen > generations) break

		pool.sort((a, b) => b.result.fitness - a.result.fitness)
		const elites = pool.slice(0, Math.max(2, Math.floor(population / 4)))
		/** @type {CandidateRecord[]} */
		const next = [...elites]

		while (next.length < population) {
			const parent = elites[next.length % elites.length]
			const tunables = mutateCandidate(parent.tunables, seedBase + gen * 1000 + next.length)
			const result = await evaluateTunables(scenarios, seeds, tunables, runSimulation, weights)
			const rec = { tunables, result, generation: gen }
			next.push(rec)
			if (result.fitness > best.result.fitness) best = rec
		}

		pool = next
		generationsRun = gen
		const snap = recordGeneration(pool, best, gen)
		history.push({
			generation: gen,
			bestFitness: best.result.fitness,
			meanFitness: snap.meanFitness,
		})

		if (timed && pastDeadline(deadline)) {
			stoppedBy = 'duration'
			break
		}

		if (!timed && gen >= generations) {
			stoppedBy = 'generations'
			break
		}

		gen++
	}

	return {
		baseline,
		best,
		history,
		stoppedBy,
		generationsRun,
		durationMs,
		elapsedMs: Date.now() - startedAt,
	}
}

/**
 * @param {number} baselineFitness 基线适应度
 * @param {number} candidateFitness 候选适应度
 * @param {number} [margin=0.02] 最小提升
 * @returns {boolean} 是否应写回 JSON
 */
export function shouldApply(baselineFitness, candidateFitness, margin = 0.02) {
	return candidateFitness >= baselineFitness + margin
}
