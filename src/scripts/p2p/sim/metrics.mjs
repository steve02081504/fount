/**
 * 仿真指标与适应度（全部内生，无外生规则惩罚）。
 */

/**
 * @typedef {{
 *   malSuppressionRate: number,
 *   honestPreservationRate: number,
 *   falsePositiveRate: number,
 *   fanoutReachRate: number,
 *   federationReachRate: number,
 *   fanoutCostRatio: number,
 *   collusionCollapseRate: number,
 *   relayPreservationRate: number,
 *   profilePreservationRate: number,
 *   sybilContainmentRate: number,
 *   archiveDefenseRate: number,
 *   mailboxReachRate: number,
 *   mailboxCostRatio: number,
 *   archiveQuorumAccuracy: number,
 *   churnReachRate: number,
 *   compromiseContainmentRate: number,
 *   sleeperReactionRate: number,
 *   equivocationDefenseRate: number,
 *   observerCount: number,
 *   maliciousCount: number,
 *   honestCount: number,
 *   groupSize: number,
 *   byAttackDefense?: Partial<Record<string, { defended: number, total: number, rate: number }>>,
 * }} SimSnapshot
 */

/** @typedef {Partial<Record<keyof SimSnapshot, number>>} MetricWeights */

/** 参与适应度加权的速率类指标 */
export const RATE_METRIC_KEYS = Object.freeze([
	'malSuppressionRate',
	'honestPreservationRate',
	'falsePositiveRate',
	'fanoutReachRate',
	'federationReachRate',
	'fanoutCostRatio',
	'collusionCollapseRate',
	'relayPreservationRate',
	'profilePreservationRate',
	'sybilContainmentRate',
	'archiveDefenseRate',
	'mailboxReachRate',
	'mailboxCostRatio',
	'archiveQuorumAccuracy',
	'churnReachRate',
	'compromiseContainmentRate',
	'sleeperReactionRate',
	'equivocationDefenseRate',
])

/** 默认适应度加权系数 */
export const DEFAULT_WEIGHTS = Object.freeze({
	malSuppressionRate: 0.18,
	honestPreservationRate: 0.15,
	collusionCollapseRate: 0.08,
	sybilContainmentRate: 0.08,
	archiveDefenseRate: 0.07,
	relayPreservationRate: 0.05,
	profilePreservationRate: 0.05,
	federationReachRate: 0.24,
	fanoutReachRate: 0.02,
	mailboxReachRate: 0.07,
	archiveQuorumAccuracy: 0.06,
	churnReachRate: 0.12,
	compromiseContainmentRate: 0.05,
	sleeperReactionRate: 0.04,
	equivocationDefenseRate: 0.04,
	falsePositiveRate: -0.16,
	fanoutCostRatio: -0.04,
	mailboxCostRatio: -0.045,
})

/**
 * @param {SimSnapshot} snap 单次快照
 * @param {MetricWeights} [weights] 权重
 * @returns {number} 适应度（越高越好）
 */
export function fitnessFromSnapshot(snap, weights = DEFAULT_WEIGHTS) {
	let score = 0
	for (const [key, weight] of Object.entries(weights)) {
		const v = snap[/** @type {keyof SimSnapshot} */ key]
		if (typeof v === 'number' && typeof weight === 'number')
			score += v * weight
	}
	return score
}

/**
 * @param {SimSnapshot[]} snaps 多次快照
 * @param {MetricWeights} [weights] 权重
 * @returns {{ mean: number, min: number, max: number, std: number, fitness: number, snapshots: SimSnapshot[] }} 聚合统计
 */
export function aggregateSnapshots(snaps, weights = DEFAULT_WEIGHTS) {
	const fitnesses = snaps.map(s => fitnessFromSnapshot(s, weights))
	const mean = fitnesses.reduce((a, b) => a + b, 0) / Math.max(1, fitnesses.length)
	const min = Math.min(...fitnesses)
	const max = Math.max(...fitnesses)
	const variance = fitnesses.reduce((s, f) => s + (f - mean) ** 2, 0) / Math.max(1, fitnesses.length)
	return {
		mean,
		min,
		max,
		std: Math.sqrt(variance),
		fitness: mean - 0.5 * Math.sqrt(variance),
		snapshots: snaps,
	}
}

/**
 * @param {import('./scenarios.mjs').SimScenario[]} scenarios 场景列表
 * @param {number[]} seeds 种子列表
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables tunables
 * @param {(scenario: import('./scenarios.mjs').SimScenario, seed: number, tunables: import('./tunables_bundle.mjs').TunablesBundle) => SimSnapshot} runSim 仿真函数
 * @param {MetricWeights} [weights] 权重
 * @returns {Promise<{ fitness: number, mean: number, min: number, max: number, std: number, byScenario: Record<string, ReturnType<typeof aggregateSnapshots>> }>} 跨场景评估结果
 */
export async function evaluateTunables(scenarios, seeds, tunables, runSim, weights = DEFAULT_WEIGHTS) {
	/** @type {Record<string, ReturnType<typeof aggregateSnapshots>>} */
	const byScenario = {}
	let totalFitness = 0
	let totalMean = 0
	let worstMin = Infinity
	let bestMax = -Infinity
	let totalStd = 0

	for (const scenario of scenarios) {
		const snaps = seeds.map(seed => runSim(scenario, seed, tunables))
		const agg = aggregateSnapshots(snaps, weights)
		byScenario[scenario.id] = agg
		totalFitness += agg.fitness
		totalMean += agg.mean
		worstMin = Math.min(worstMin, agg.min)
		bestMax = Math.max(bestMax, agg.max)
		totalStd += agg.std
	}

	const n = Math.max(1, scenarios.length)
	return {
		fitness: totalFitness / n,
		mean: totalMean / n,
		min: worstMin,
		max: bestMax,
		std: totalStd / n,
		byScenario,
	}
}

/**
 * @param {SimSnapshot} baseline 基线快照
 * @param {SimSnapshot} best 最优快照
 * @returns {Array<{ key: string, baseline: number, best: number }>} 各维度对比行
 */
export function snapshotMetricRows(baseline, best) {
	return RATE_METRIC_KEYS.map(key => ({
		key,
		baseline: baseline[key],
		best: best[key],
	}))
}
