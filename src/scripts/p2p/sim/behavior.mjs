/**
 * 诚实节点浮点行为向量（每维 [0,1]）。
 */

/** @typedef {'postRate' | 'likeRate' | 'replyRate' | 'relayRate' | 'chunkServeRate' | 'onlineStability' | 'blockProneness' | 'archiveSubmitRate' | 'mentionRate' | 'burstPostRate'} BehaviorKey */

/**
 * @typedef {Record<BehaviorKey, number>} NodeBehavior
 */

/**
 * @typedef {Partial<Record<BehaviorKey, { min?: number, max?: number, mean?: number }>>} BehaviorDist
 */

/** @type {BehaviorKey[]} */
export const BEHAVIOR_KEYS = Object.freeze([
	'postRate',
	'likeRate',
	'replyRate',
	'relayRate',
	'chunkServeRate',
	'onlineStability',
	'blockProneness',
	'archiveSubmitRate',
	'mentionRate',
	'burstPostRate',
])

/** 均衡默认分布 */
export const DEFAULT_BEHAVIOR_DIST = Object.freeze({
	postRate: { mean: 0.45, min: 0.1, max: 0.9 },
	likeRate: { mean: 0.35, min: 0, max: 0.95 },
	replyRate: { mean: 0.3, min: 0, max: 0.85 },
	relayRate: { mean: 0.4, min: 0.05, max: 0.9 },
	chunkServeRate: { mean: 0.35, min: 0, max: 0.8 },
	onlineStability: { mean: 0.75, min: 0.3, max: 1 },
	blockProneness: { mean: 0.08, min: 0, max: 0.4 },
	archiveSubmitRate: { mean: 0.25, min: 0, max: 0.7 },
	mentionRate: { mean: 0.15, min: 0, max: 0.6 },
	burstPostRate: { mean: 0, min: 0, max: 0.5 },
})

/**
 * @param {() => number} rng 随机源
 * @param {BehaviorDist} [dist] 分布
 * @returns {NodeBehavior} 采样行为向量
 */
export function sampleBehavior(rng, dist = {}) {
	/** @type {Partial<NodeBehavior>} */
	const behavior = {}
	for (const key of BEHAVIOR_KEYS) {
		const spec = dist[key] ?? DEFAULT_BEHAVIOR_DIST[key] ?? { mean: 0.5 }
		const min = spec.min ?? 0
		const max = spec.max ?? 1
		const mean = spec.mean ?? (min + max) / 2
		const spread = (max - min) * 0.5
		behavior[key] = Math.max(min, Math.min(max, mean + (rng() - 0.5) * spread))
	}
	return /** @type {NodeBehavior} */ behavior
}

/**
 * @param {NodeBehavior} behavior 行为向量
 * @returns {boolean} 是否「只点赞不发帖」型静默用户
 */
export function isQuietHonestBehavior(behavior) {
	return behavior.postRate < 0.15 && behavior.likeRate >= 0.4 && behavior.replyRate < 0.25
}

/**
 * @param {() => number} rng 随机源
 * @param {NodeBehavior} behavior 行为向量
 * @param {BehaviorKey} key 维度
 * @returns {boolean} 本回合是否触发
 */
export function behaviorRoll(rng, behavior, key) {
	return rng() < (behavior[key] ?? 0)
}
