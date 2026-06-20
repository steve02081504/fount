/**
 * 预设节点组合场景。
 */

/** @typedef {import('./attacks.mjs').AttackKind} AttackKind */
/** @typedef {import('./model.mjs').NodeProfile} NodeProfile */

/**
 * @typedef {Partial<Record<NodeProfile, number>>} ProfileMix
 */

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   honestCount: number,
 *   attacks: Partial<Record<AttackKind, number>>,
 *   relayCount?: number,
 *   lurkerCount?: number,
 *   newcomerCount?: number,
 *   profileMix?: ProfileMix,
 *   rounds?: number,
 *   groupSize?: number,
 *   decayWindows?: number,
 *   churnRate?: number,
 *   offlineRate?: number,
 *   eclipseTargetCount?: number,
 *   sleeperTurnRound?: number,
 * }} SimScenario
 */

/** @type {SimScenario[]} */
export const SCENARIOS = [
	{
		id: 'balanced',
		label: '均衡诚实+混合恶意',
		honestCount: 12,
		relayCount: 2,
		lurkerCount: 2,
		newcomerCount: 3,
		profileMix: { both: 0.5, social_only: 0.15, chat_only: 0.15, wanderer: 0.2 },
		attacks: {
			sybil: 4, collusion: 4, spammer: 2, false_accuser: 2, eclipse: 2,
			lazy_chunk: 2, social_mob: 2, archive_forger: 2, relay_farmer: 2, hint_poisoner: 2,
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
		attacks: { sybil: 16, eclipse: 4, relay_farmer: 4, hint_poisoner: 4 },
		rounds: 50,
		groupSize: 6,
	},
	{
		id: 'collusion_ring',
		label: '邀请链共谋环',
		honestCount: 10,
		relayCount: 1,
		attacks: { collusion: 12, whitewasher: 4 },
		rounds: 45,
		groupSize: 10,
		decayWindows: 6,
	},
	{
		id: 'social_war',
		label: 'Social 群体拉黑',
		honestCount: 10,
		profileMix: { social_only: 0.4, both: 0.3, wanderer: 0.3 },
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
		profileMix: { chat_only: 0.5, both: 0.3, wanderer: 0.2 },
		attacks: { spammer: 6, eclipse: 6, lazy_chunk: 4, oscillator: 3 },
		rounds: 40,
		groupSize: 6,
	},
	{
		id: 'relay_mesh',
		label: 'subfount 中转网格',
		honestCount: 6,
		relayCount: 8,
		lurkerCount: 2,
		profileMix: { chat_only: 0.6, both: 0.4 },
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
		profileMix: { social_only: 0.25, chat_only: 0.25, both: 0.25, wanderer: 0.25 },
		attacks: { social_mob: 3, lazy_chunk: 3, archive_forger: 2, false_accuser: 2, hint_poisoner: 2 },
		rounds: 40,
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
		churnRate: 0.18,
		offlineRate: 0.12,
	},
	{
		id: 'key_compromise',
		label: '高信誉身份被盗',
		honestCount: 10,
		relayCount: 2,
		attacks: { key_thief: 3, archive_forger: 2, spammer: 2 },
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
		attacks: { equivocator: 4, archive_forger: 2 },
		rounds: 35,
		groupSize: 6,
	},
	{
		id: 'eclipse_targeted',
		label: '定向 eclipse 分区',
		honestCount: 10,
		relayCount: 2,
		attacks: { targeted_eclipse: 4, eclipse: 2, rep_pump: 2 },
		rounds: 40,
		groupSize: 8,
		eclipseTargetCount: 2,
		churnRate: 0.08,
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
