/**
 * Social 信誉传导纯算子（模拟器与 reputation_social.mjs 共用）。
 */
import {
	clampReputationScore,
	computeRepMaxEff,
	REP_MAX,
	subjectiveSlashPenalty,
} from './reputation_math.mjs'
import socialTunables from './reputation_social.tunables.json' with { type: 'json' }

/** @typedef {import('./reputation_store.mjs').ReputationFile} ReputationFile */

/**
 * @returns {typeof socialTunables} 默认 tunables
 */
export function defaultSocialTunables() {
	return socialTunables
}

/**
 * 社交 block 记账衰减（已禁用：拉黑不衰减）。
 * @param {object} _row byNodeHash 行
 * @param {number} [_now] 当前时间
 * @param {typeof socialTunables} [_tunables] tunables
 * @returns {void}
 */
export function applyRowSocialBlockDecay(_row, _now = Date.now(), _tunables = socialTunables) {
	// 社交拉黑不衰减：老死不相往来，直至显式 unblock
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {number} [now] 当前时间
 * @param {typeof socialTunables} [tunables] tunables
 * @returns {void}
 */
export function applySocialBlockDecayAllPure(data, now = Date.now(), tunables = socialTunables) {
	void data
	void now
	void tunables
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
	row.socialBlocks ??= {}

	if (isBlock) {
		if (row.socialBlocks[voterKey]) return false
		const repMaxEff = computeRepMaxEff(data)
		const repSender = selfTrust
			? REP_MAX
			: Number(data.byNodeHash[followerNodeHash]?.score ?? 0)
		const penalty = subjectiveSlashPenalty(tunables.socialBlockClaim, repSender, repMaxEff, selfTrust)
		row.score = clampReputationScore(Number(row.score ?? 0) - penalty)
		row.socialBlocks[voterKey] = { penalty, appliedAt: now, decayedRefund: 0 }
		data.byNodeHash[targetNodeHash] = row
		return true
	}

	const record = row.socialBlocks[voterKey]
	if (!record) return false
	const remaining = Number(record.penalty) - Number(record.decayedRefund || 0)
	if (remaining > 0)
		row.score = clampReputationScore(Number(row.score ?? 0) + remaining)
	delete row.socialBlocks[voterKey]
	data.byNodeHash[targetNodeHash] = row
	return true
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {object} opts 参数
 * @param {string} opts.followerNodeHash 关注者节点
 * @param {string} opts.targetNodeHash 被怀疑节点
 * @param {string} opts.voterKey 投票键（entityHash）
 * @param {'suspect' | 'unsuspect'} opts.action 动作
 * @param {boolean} [opts.selfTrust] 自己声明时满信任权重
 * @param {number} [now] 当前时间
 * @param {typeof socialTunables} [tunables] tunables
 * @returns {boolean} 是否已应用
 */
export function applyFollowedSuspectSignalPure(data, opts, now = Date.now(), tunables = socialTunables) {
	const { followerNodeHash, targetNodeHash, voterKey, action } = opts
	const isSuspect = action === 'suspect'
	const selfTrust = !!opts.selfTrust

	applySocialSuspectDecayAllPure(data, now, tunables)
	const row = data.byNodeHash[targetNodeHash] || { score: 0 }
	row.socialSuspects ??= {}

	if (isSuspect) {
		if (row.socialSuspects[voterKey]) return false
		const repMaxEff = computeRepMaxEff(data)
		const repSender = selfTrust
			? REP_MAX
			: Number(data.byNodeHash[followerNodeHash]?.score ?? 0)
		const penalty = subjectiveSlashPenalty(tunables.socialSuspectClaim, repSender, repMaxEff, selfTrust)
		row.score = clampReputationScore(Number(row.score ?? 0) - penalty)
		row.socialSuspects[voterKey] = { penalty, appliedAt: now, decayedRefund: 0 }
		data.byNodeHash[targetNodeHash] = row
		return true
	}

	const record = row.socialSuspects[voterKey]
	if (!record) return false
	const remaining = Number(record.penalty) - Number(record.decayedRefund || 0)
	if (remaining > 0)
		row.score = clampReputationScore(Number(row.score ?? 0) + remaining)
	delete row.socialSuspects[voterKey]
	data.byNodeHash[targetNodeHash] = row
	return true
}

/**
 * @param {object} row byNodeHash 行
 * @param {number} [now] 当前时间
 * @param {typeof socialTunables} [tunables] tunables
 * @returns {void}
 */
export function applyRowSocialSuspectDecay(row, now = Date.now(), tunables = socialTunables) {
	if (!row?.socialSuspects) return
	let refund = 0
	for (const [voter, record] of Object.entries(row.socialSuspects)) {
		const appliedAt = Number(record?.appliedAt)
		const penalty = Number(record?.penalty)
		if (!Number.isFinite(penalty) || penalty <= 0) continue
		if (!Number.isFinite(appliedAt) || now - appliedAt < tunables.socialSuspectDecayMs) continue
		const windows = Math.floor((now - appliedAt) / tunables.socialSuspectDecayMs)
		if (windows <= 0) continue
		const decayed = penalty * (1 - (1 - tunables.socialSuspectDecayFraction) ** windows)
		const delta = decayed - Number(record.decayedRefund || 0)
		if (delta > 0) {
			refund += delta
			record.decayedRefund = decayed
		}
		void voter
	}
	if (refund > 0)
		row.score = clampReputationScore(Number(row.score ?? 0) + refund)
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {number} [now] 当前时间
 * @param {typeof socialTunables} [tunables] tunables
 * @returns {void}
 */
export function applySocialSuspectDecayAllPure(data, now = Date.now(), tunables = socialTunables) {
	for (const nodeId of Object.keys(data.byNodeHash || {}))
		applyRowSocialSuspectDecay(data.byNodeHash[nodeId], now, tunables)
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
