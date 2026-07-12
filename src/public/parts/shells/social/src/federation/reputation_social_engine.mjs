/**
 * Social 信誉传导纯算子（模拟器与 reputation_social.mjs 共用）。
 */
import {
	clampReputationScore,
	computeRepMaxEff,
	REP_MAX,
	subjectiveSlashPenalty,
} from '../../../../../../scripts/p2p/reputation_math.mjs'
import socialTunables from './reputation_social.tunables.json' with { type: 'json' }

/** @typedef {import('../../../../../../scripts/p2p/reputation_store.mjs').ReputationFile} ReputationFile */

/**
 * @returns {typeof socialTunables} 默认 tunables
 */
export function defaultSocialTunables() {
	return socialTunables
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {object} opts 参数
 * @param {string} opts.followerNodeHash 关注者节点
 * @param {string} opts.targetNodeHash 被拉黑节点
 * @param {string} opts.voterKey 投票键（entityHash）
 * @param {'block' | 'unblock'} opts.action 动作
 * @param {boolean} [opts.selfTrust] 自己拉黑时满信任权重
 * @param {number} [now] 当前时间
 * @param {typeof socialTunables} [tunables] tunables
 * @returns {boolean} 是否已应用
 */
export function applyFollowedBlockSignalPure(data, opts, now = Date.now(), tunables = socialTunables) {
	const { followerNodeHash, targetNodeHash, voterKey, action } = opts
	const isBlock = action === 'block'
	const selfTrust = !!opts.selfTrust

	const row = data.byNodeHash[targetNodeHash] || { score: 0 }
	row.blockPenalties ??= {}

	if (isBlock) {
		if (row.blockPenalties[voterKey]) return false
		const repMaxEff = computeRepMaxEff(data)
		const repSender = selfTrust
			? REP_MAX
			: Number(data.byNodeHash[followerNodeHash]?.score ?? 0)
		const penalty = subjectiveSlashPenalty(tunables.socialBlockClaim, repSender, repMaxEff, selfTrust)
		row.score = clampReputationScore(Number(row.score ?? 0) - penalty)
		row.blockPenalties[voterKey] = { penalty, appliedAt: now, decayedRefund: 0 }
		data.byNodeHash[targetNodeHash] = row
		return true
	}

	const record = row.blockPenalties[voterKey]
	if (!record) return false
	const remaining = Number(record.penalty) - Number(record.decayedRefund || 0)
	if (remaining > 0)
		row.score = clampReputationScore(Number(row.score ?? 0) + remaining)
	delete row.blockPenalties[voterKey]
	data.byNodeHash[targetNodeHash] = row
	return true
}

/**
 * @param {number} score 节点分
 * @param {typeof socialTunables} [tunables] tunables
 * @returns {boolean} 是否应隐藏
 */
export function shouldHideByScore(score, tunables = socialTunables) {
	return score < tunables.socialRepHideThreshold
}

/**
 * @param {number} score 节点分
 * @param {typeof socialTunables} [tunables] tunables
 * @returns {number} 排序惩罚
 */
export function reputationSortPenaltyFromScore(score, tunables = socialTunables) {
	if (score >= tunables.socialRepDemoteThreshold) return 0
	return Math.round((tunables.socialRepDemoteThreshold - score) * 1_000_000)
}
