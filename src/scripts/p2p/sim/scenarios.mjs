/**
 * 预设节点组合场景。
 */

/** @typedef {import('./attacks.mjs').AttackKind} AttackKind */
/** @typedef {import('./behavior.mjs').BehaviorDist} BehaviorDist */

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   honestCount: number,
 *   attacks: Partial<Record<AttackKind, number>>,
 *   relayCount?: number,
 *   lurkerCount?: number,
 *   newcomerCount?: number,
 *   behaviorDist?: BehaviorDist,
 *   rounds?: number,
 *   groupSize?: number,
 *   decayWindows?: number,
 *   churnRate?: number,
 *   offlineRate?: number,
 *   eclipseTargetCount?: number,
 *   sleeperTurnRound?: number,
 *   keyRecoveryRound?: number,
 * }} SimScenario
 */

/** 社交侧偏重 */
const SOCIAL_HEAVY = Object.freeze({
	postRate: { mean: 0.55, min: 0.25, max: 0.85 },
	likeRate: { mean: 0.45, min: 0.15, max: 0.9 },
	replyRate: { mean: 0.35, min: 0.1, max: 0.7 },
	relayRate: { mean: 0.12, min: 0, max: 0.3 },
	chunkServeRate: { mean: 0.1, min: 0, max: 0.25 },
})

/** 聊天侧偏重 */
const CHAT_HEAVY = Object.freeze({
	postRate: { mean: 0.12, min: 0, max: 0.25 },
	likeRate: { mean: 0.15, min: 0, max: 0.35 },
	replyRate: { mean: 0.2, min: 0, max: 0.4 },
	relayRate: { mean: 0.55, min: 0.25, max: 0.85 },
	chunkServeRate: { mean: 0.45, min: 0.15, max: 0.75 },
})

/** 静默点赞型 */
const QUIET_LIKER = Object.freeze({
	postRate: { mean: 0.08, min: 0, max: 0.15 },
	likeRate: { mean: 0.58, min: 0.4, max: 0.85 },
	replyRate: { mean: 0.12, min: 0, max: 0.22 },
	relayRate: { mean: 0.15, min: 0.05, max: 0.3 },
})

/** 均衡混合 */
const MIXED = Object.freeze({
	postRate: { mean: 0.35, min: 0.1, max: 0.7 },
	likeRate: { mean: 0.3, min: 0.05, max: 0.75 },
	replyRate: { mean: 0.28, min: 0.05, max: 0.6 },
	relayRate: { mean: 0.35, min: 0.1, max: 0.65 },
})

/** @type {SimScenario[]} */
export const SCENARIOS = [
	{
		id: 'balanced',
		label: '均衡诚实+混合恶意',
		honestCount: 12,
		relayCount: 2,
		lurkerCount: 2,
		newcomerCount: 3,
		behaviorDist: MIXED,
		attacks: {
			sybil: 6, collusion: 5, spammer: 3, false_accuser: 3, eclipse: 3,
			lazy_chunk: 3, social_mob: 3, archive_forger: 3, relay_farmer: 3, hint_poisoner: 3,
			rep_pump: 2,
		},
		rounds: 40,
		groupSize: 8,
	},
	{
		id: 'sybil_heavy',
		label: 'Sybil 洪水',
		honestCount: 8,
		relayCount: 2,
		newcomerCount: 4,
		attacks: { sybil: 20, eclipse: 5, relay_farmer: 5, hint_poisoner: 5, rep_pump: 4 },
		rounds: 50,
		groupSize: 6,
	},
	{
		id: 'collusion_ring',
		label: '邀请链共谋环',
		honestCount: 10,
		relayCount: 1,
		attacks: { collusion: 14, whitewasher: 6, rep_pump: 3 },
		rounds: 45,
		groupSize: 10,
		decayWindows: 6,
	},
	{
		id: 'social_war',
		label: 'Social 群体拉黑',
		honestCount: 10,
		behaviorDist: SOCIAL_HEAVY,
		attacks: { social_mob: 8, false_accuser: 4, report_flooder: 3 },
		rounds: 35,
		groupSize: 8,
		decayWindows: 6,
	},
	{
		id: 'spam_eclipse',
		label: '刷消息 + eclipse',
		honestCount: 10,
		lurkerCount: 2,
		behaviorDist: CHAT_HEAVY,
		attacks: { spammer: 8, eclipse: 8, lazy_chunk: 5, oscillator: 4, rep_pump: 2 },
		rounds: 40,
		groupSize: 6,
	},
	{
		id: 'relay_mesh',
		label: 'subfount 中转网格',
		honestCount: 6,
		relayCount: 8,
		lurkerCount: 2,
		behaviorDist: CHAT_HEAVY,
		attacks: { relay_farmer: 4, sybil: 3, eclipse: 2 },
		rounds: 45,
		groupSize: 10,
	},
	{
		id: 'usage_mix',
		label: '使用画像混合',
		honestCount: 14,
		relayCount: 2,
		lurkerCount: 2,
		newcomerCount: 3,
		behaviorDist: {
			...MIXED,
			postRate: { mean: 0.25, min: 0.05, max: 0.55 },
			likeRate: { mean: 0.4, min: 0.15, max: 0.75 },
		},
		attacks: { social_mob: 3, lazy_chunk: 4, archive_forger: 3, false_accuser: 3, hint_poisoner: 3, equivocator: 2 },
		rounds: 40,
		groupSize: 8,
	},
	{
		id: 'quiet_honest',
		label: '静默点赞用户',
		honestCount: 12,
		behaviorDist: QUIET_LIKER,
		attacks: { false_accuser: 4, social_mob: 3, spammer: 2 },
		rounds: 35,
		groupSize: 8,
	},
	{
		id: 'churn_storm',
		label: '高 churn + 掉线风暴',
		honestCount: 10,
		relayCount: 4,
		lurkerCount: 2,
		attacks: { sybil: 3, eclipse: 3, relay_farmer: 2 },
		rounds: 45,
		groupSize: 8,
		churnRate: 0.22,
		offlineRate: 0.15,
	},
	{
		id: 'key_compromise',
		label: '高信誉身份被盗',
		honestCount: 10,
		relayCount: 2,
		attacks: { key_thief: 4, archive_forger: 3, spammer: 3, equivocator: 2 },
		rounds: 40,
		groupSize: 8,
	},
	{
		id: 'sleeper_turn',
		label: '肉鸡突变',
		honestCount: 10,
		relayCount: 2,
		attacks: { sleeper: 4, collusion: 2 },
		rounds: 45,
		groupSize: 8,
		sleeperTurnRound: 12,
	},
	{
		id: 'digest_equivocation',
		label: '归档 digest 等价欺骗',
		honestCount: 8,
		relayCount: 2,
		attacks: { equivocator: 6, archive_forger: 3 },
		rounds: 35,
		groupSize: 6,
	},
	{
		id: 'eclipse_targeted',
		label: '定向 eclipse 分区',
		honestCount: 10,
		relayCount: 2,
		attacks: { targeted_eclipse: 5, eclipse: 3, rep_pump: 4 },
		rounds: 40,
		groupSize: 8,
		eclipseTargetCount: 3,
		churnRate: 0.12,
		offlineRate: 0.08,
	},
	{
		id: 'key_recovery',
		label: 'recovery 钥吊销被盗活跃钥',
		honestCount: 10,
		relayCount: 2,
		attacks: { key_thief: 4, spammer: 2 },
		rounds: 40,
		groupSize: 8,
		keyRecoveryRound: 18,
	},
	{
		id: 'sleeper_anomaly',
		label: '肉鸡突变 + 异常隔离',
		honestCount: 10,
		relayCount: 2,
		attacks: { sleeper: 5, collusion: 2 },
		rounds: 45,
		groupSize: 8,
		sleeperTurnRound: 10,
	},
	{
		id: 'suspect_cascade',
		label: '怀疑声明级联',
		honestCount: 12,
		behaviorDist: SOCIAL_HEAVY,
		attacks: { social_mob: 6, false_accuser: 3, hint_poisoner: 2 },
		rounds: 35,
		groupSize: 8,
	},
	{
		id: 'large_balanced',
		label: '大群均衡（30 诚实）',
		honestCount: 30,
		relayCount: 4,
		lurkerCount: 4,
		newcomerCount: 6,
		behaviorDist: MIXED,
		attacks: {
			sybil: 8, collusion: 6, spammer: 4, false_accuser: 3, eclipse: 4,
			lazy_chunk: 4, social_mob: 3, archive_forger: 3, relay_farmer: 3, hint_poisoner: 3,
			rep_pump: 3, equivocator: 2,
		},
		rounds: 45,
		groupSize: 12,
	},
	{
		id: 'large_sybil_storm',
		label: '大群 Sybil 风暴（40 诚实）',
		honestCount: 40,
		relayCount: 6,
		newcomerCount: 8,
		attacks: { sybil: 24, eclipse: 8, relay_farmer: 6, hint_poisoner: 6, rep_pump: 5, whitewasher: 4 },
		rounds: 50,
		groupSize: 14,
		churnRate: 0.1,
	},
]

/**
 * @param {string} [id] 场景 id（`all` 或省略返回全部）
 * @returns {SimScenario[]} 匹配的场景列表
 */
export function resolveScenarios(id) {
	if (!id || id === 'all') return SCENARIOS
	const one = SCENARIOS.find(s => s.id === id)
	return one ? [one] : SCENARIOS
}
