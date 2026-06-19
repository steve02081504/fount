/**
 * 预设节点组合场景。
 */

/** @typedef {import('./attacks.mjs').AttackKind} AttackKind */

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   honestCount: number,
 *   attacks: Partial<Record<AttackKind, number>>,
 *   rounds?: number,
 *   groupSize?: number,
 * }} SimScenario
 */

/** @type {SimScenario[]} */
export const SCENARIOS = [
	{
		id: 'balanced',
		label: '均衡诚实+混合恶意',
		honestCount: 12,
		attacks: { sybil: 4, collusion: 3, spammer: 2, false_accuser: 2, eclipse: 2, lazy_chunk: 2, social_mob: 2 },
		rounds: 40,
		groupSize: 8,
	},
	{
		id: 'sybil_heavy',
		label: 'Sybil 洪水',
		honestCount: 8,
		attacks: { sybil: 16, eclipse: 4 },
		rounds: 50,
		groupSize: 6,
	},
	{
		id: 'collusion_ring',
		label: '邀请链共谋环',
		honestCount: 10,
		attacks: { collusion: 10 },
		rounds: 45,
		groupSize: 10,
	},
	{
		id: 'social_war',
		label: 'Social 群体拉黑',
		honestCount: 10,
		attacks: { social_mob: 8, false_accuser: 4 },
		rounds: 35,
		groupSize: 8,
	},
	{
		id: 'spam_eclipse',
		label: '刷消息 + eclipse',
		honestCount: 10,
		attacks: { spammer: 6, eclipse: 6, lazy_chunk: 4 },
		rounds: 40,
		groupSize: 6,
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
