import reputationTunables from './reputation.tunables.json' with { type: 'json' }

/**
 * 主观信誉标量下界（§0.3）。
 * @type {number}
 */
export const REP_MIN = -1
/**
 * 主观信誉标量上界（§0.3）。
 * @type {number}
 */
export const REP_MAX = 1
/** §0.1：`rep_max_eff = max(已链邻居最大信誉, ε)` */
export const REP_MAX_EFF_EPS = 1e-12

/**
 * @param {number} x 任意标量
 * @returns {number} clamp 到 [-1, 1]
 */
export function clampReputationScore(x) {
	return Math.min(REP_MAX, Math.max(REP_MIN, x))
}

/**
 * @param {{ byNodeHash?: Record<string, { score?: number }> }} data 信誉表
 * @returns {number} `max(已链邻居最大信誉, ε)`（§0.1 `rep_max_eff`）
 */
export function computeRepMaxEff(data) {
	let maxScore = /** @type {number | null} */ null
	for (const nodeId of Object.keys(data.byNodeHash)) {
		const score = Number(data.byNodeHash[nodeId]?.score)
		if (Number.isFinite(score)) maxScore = maxScore === null ? score : Math.max(maxScore, score)
	}
	return Math.max(maxScore === null ? 0 : clampReputationScore(maxScore), REP_MAX_EFF_EPS)
}

/**
 * 不可验证 Slash 落地扣分（§0.1）。
 * @param {number} claim 主张强度
 * @param {number} repSender 发送方信誉
 * @param {number} repMaxEff 分母
 * @param {boolean} [verified] 是否可验证
 * @param {typeof reputationTunables} [tunables] tunables
 * @returns {number} 对目标的扣分幅度（正数）
 */
export function subjectiveSlashPenalty(claim, repSender, repMaxEff, verified = false, tunables = reputationTunables) {
	const claimStrength = Number.isFinite(claim) ? claim : tunables.slashDefaultClaim
	return verified
		? Math.abs(claimStrength) * tunables.slashVerifiedMultiplier
		: Math.abs((claimStrength * repSender) / repMaxEff)
}

/**
 * §0.3 初值：`clamp(rep_local(intro) * reputationEdge)`。
 * @param {number} introRep 介绍者信誉
 * @param {number} [repEdge] 边信任
 * @returns {number} 新成员初值
 */
export function seedReputationFromIntro(introRep, repEdge = 1) {
	return clampReputationScore(introRep * (Number.isFinite(repEdge) ? clampReputationScore(repEdge) : 1))
}
