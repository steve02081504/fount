/**
 * 参数搜索（随机 + 进化）。
 */
import { pastDeadline } from './duration.mjs'
import { evaluateTunables, minPanelFitness } from './metrics.mjs'
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
 *   generation: number,
 *   generationsRun: number,
 *   bestFitness: number,
 *   meanFitness: number,
 *   elapsedMs: number,
 *   durationMs: number | null,
 *   generations: number,
 *   percent: number,
 * }} OptimizerProgress
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
 * @param {number | null} durationMs 时长上限
 * @param {number} generations 代数上限
 * @param {number} generation 当前代
 * @param {number} elapsedMs 已用毫秒
 * @param {boolean} timed 是否按时间停止
 * @returns {number} 0..100 进度百分比
 */
export function computeProgressPercent(durationMs, generations, generation, elapsedMs, timed) {
	let raw
	if (timed && durationMs != null && durationMs > 0)
		raw = (elapsedMs / durationMs) * 100
	else
		raw = generations > 0 ? (generation / generations) * 100 : 0
	return Math.max(0, Math.min(100, raw))
}

/**
 * @param {CandidateRecord[]} pool 当前种群
 * @param {CandidateRecord} best 当前最优
 * @returns {{ pool: CandidateRecord[], best: CandidateRecord, meanFitness: number }} 本代统计
 */
function recordGeneration(pool, best) {
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
 * @param {(info: OptimizerProgress) => void} [opts.onProgress] 进度回调
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
		onProgress,
	} = opts

	const startedAt = Date.now()
	const deadline = durationMs != null && durationMs > 0 ? startedAt + durationMs : null
	const timed = deadline != null

	/**
	 * @param {number} generation 代数
	 * @param {number} generationsRun 已完成代数
	 * @param {number} bestFitness 最优适应度
	 * @param {number} meanFitness 平均适应度
	 */
	function emitProgress(generation, generationsRun, bestFitness, meanFitness) {
		if (!onProgress) return
		const elapsedMs = Date.now() - startedAt
		onProgress({
			generation,
			generationsRun,
			bestFitness,
			meanFitness,
			elapsedMs,
			durationMs,
			generations,
			percent: computeProgressPercent(durationMs, generations, generation, elapsedMs, timed),
		})
	}

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
		const snap = recordGeneration(pool, best)
		history.push({
			generation: 0,
			bestFitness: best.result.fitness,
			meanFitness: snap.meanFitness,
		})
		emitProgress(0, 0, best.result.fitness, snap.meanFitness)
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
		const snap = recordGeneration(pool, best)
		history.push({
			generation: gen,
			bestFitness: best.result.fitness,
			meanFitness: snap.meanFitness,
		})
		emitProgress(gen, generationsRun, best.result.fitness, snap.meanFitness)

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
 * 写回门槛（防单场景过拟合）：必须在**全场景**总适应度上超过基线 + margin，
 * 且不得让任何单一场景相对基线明显回退。
 * @param {Awaited<ReturnType<typeof evaluateTunables>>} baselineEval 全场景基线评估
 * @param {Awaited<ReturnType<typeof evaluateTunables>>} candidateEval 全场景候选评估
 * @param {object} [opts] 选项
 * @param {number} [opts.margin=0.02] 全场景最小提升
 * @param {number} [opts.regressTol=0.01] 单场景允许的最大回退
 * @returns {{ ok: boolean, reason: string }} 是否应写回与原因
 */
export function shouldApplyResult(baselineEval, candidateEval, opts = {}) {
	const { margin = 0.02, regressTol = 0.01 } = opts
	if (candidateEval.fitness < baselineEval.fitness + margin)
		return {
			ok: false,
			reason: `全场景 fitness ${candidateEval.fitness.toFixed(4)} 未超过基线 ${baselineEval.fitness.toFixed(4)} + margin ${margin}`,
		}
	for (const [id, agg] of Object.entries(candidateEval.byScenario)) {
		const base = baselineEval.byScenario[id]
		if (base && agg.fitness < base.fitness - regressTol)
			return {
				ok: false,
				reason: `场景 ${id} 回退（${agg.fitness.toFixed(4)} < 基线 ${base.fitness.toFixed(4)} - ${regressTol}）`,
			}
	}
	const baseMin = minPanelFitness(baselineEval.byScenario)
	const candMin = minPanelFitness(candidateEval.byScenario)
	if (candMin < baseMin - regressTol)
		return {
			ok: false,
			reason: `面板最差 min ${candMin.toFixed(4)} 低于基线 ${baseMin.toFixed(4)} - ${regressTol}`,
		}
	return { ok: true, reason: 'ok' }
}
