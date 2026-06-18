/**
 * Social 公开拉黑 → 节点级信誉传导（agent/user 同等，惩罚打在 target nodeHash）。
 */
import { parseEntityHash } from './entity_id.mjs'
import {
	clampReputationScore,
	computeRepMaxEff,
	REP_MAX,
	subjectiveSlashPenalty,
} from './reputation_math.mjs'

/** 公开拉黑主张强度 */
export const SOCIAL_BLOCK_CLAIM = 0.5

/** feed/搜索：低于此分直接隐藏作者 */
export const SOCIAL_REP_HIDE_THRESHOLD = -0.5

/** feed：低于此分降权排序 */
export const SOCIAL_REP_DEMOTE_THRESHOLD = 0

/** 单条 social block 记账温和衰减窗口（毫秒） */
export const SOCIAL_BLOCK_DECAY_MS = 90 * 24 * 3600 * 1000

/** 每个衰减窗口回补比例（对已记账 penalty 的一部分） */
export const SOCIAL_BLOCK_DECAY_FRACTION = 0.02

/**
 * @param {object} row byNodeHash 行
 * @returns {void}
 */
function applyRowSocialBlockDecay(row) {
	if (!row?.socialBlocks) return
	const now = Date.now()
	let refund = 0
	for (const [voter, record] of Object.entries(row.socialBlocks)) {
		const appliedAt = Number(record?.appliedAt)
		const penalty = Number(record?.penalty)
		if (!Number.isFinite(penalty) || penalty <= 0) continue
		if (!Number.isFinite(appliedAt) || now - appliedAt < SOCIAL_BLOCK_DECAY_MS) continue
		const windows = Math.floor((now - appliedAt) / SOCIAL_BLOCK_DECAY_MS)
		if (windows <= 0) continue
		const decayed = penalty * (1 - (1 - SOCIAL_BLOCK_DECAY_FRACTION) ** windows)
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
 * @param {import('./reputation_store.mjs').ReputationFile} data 信誉表
 * @returns {void}
 */
export function applySocialBlockDecayAll(data) {
	for (const nodeId of Object.keys(data.byNodeHash || {}))
		applyRowSocialBlockDecay(data.byNodeHash[nodeId])
}

/**
 * @param {object} opts 参数
 * @param {string} opts.followerEntityHash 关注者（拉黑发起方）实体
 * @param {string} opts.targetEntityHash 被拉黑实体
 * @param {'block' | 'unblock'} opts.action 动作
 * @param {boolean} [opts.selfTrust] 自己拉黑时满信任权重
 * @param {(mutator: (data: import('./reputation_store.mjs').ReputationFile) => void | Promise<void>) => Promise<void>} mutateReputation 突变器
 * @returns {Promise<boolean>} 是否已应用
 */
export async function applyFollowedBlockSignal(opts, mutateReputation) {
	const follower = parseEntityHash(opts.followerEntityHash)
	const target = parseEntityHash(opts.targetEntityHash)
	if (!follower || !target) return false

	const followerNodeHash = follower.nodeHash
	const targetNodeHash = target.nodeHash
	const voterKey = follower.entityHash
	const isBlock = opts.action === 'block'
	const selfTrust = !!opts.selfTrust

	await mutateReputation(data => {
		applySocialBlockDecayAll(data)
		const row = data.byNodeHash[targetNodeHash] || { score: 0 }
		row.socialBlocks ??= {}

		if (isBlock) {
			if (row.socialBlocks[voterKey]) return
			const repMaxEff = computeRepMaxEff(data)
			const repSender = selfTrust
				? REP_MAX
				: Number(data.byNodeHash[followerNodeHash]?.score ?? 0)
			const penalty = subjectiveSlashPenalty(SOCIAL_BLOCK_CLAIM, repSender, repMaxEff, selfTrust)
			row.score = clampReputationScore(Number(row.score ?? 0) - penalty)
			row.socialBlocks[voterKey] = { penalty, appliedAt: Date.now(), decayedRefund: 0 }
			data.byNodeHash[targetNodeHash] = row
			return
		}

		const record = row.socialBlocks[voterKey]
		if (!record) return
		const remaining = Number(record.penalty) - Number(record.decayedRefund || 0)
		if (remaining > 0)
			row.score = clampReputationScore(Number(row.score ?? 0) + remaining)
		delete row.socialBlocks[voterKey]
		data.byNodeHash[targetNodeHash] = row
	})
	return true
}

/**
 * @param {string} entityHash 作者实体
 * @param {(nodeId: string) => number} scoreOf 取分函数
 * @returns {boolean} 是否应隐藏
 */
export function shouldHideAuthorByReputation(entityHash, scoreOf) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed) return false
	return scoreOf(parsed.nodeHash) < SOCIAL_REP_HIDE_THRESHOLD
}

/**
 * @param {string} entityHash 作者实体
 * @param {(nodeId: string) => number} scoreOf 取分函数
 * @returns {number} 排序惩罚（越大越靠后）
 */
export function reputationSortPenalty(entityHash, scoreOf) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed) return 0
	const score = scoreOf(parsed.nodeHash)
	if (score >= SOCIAL_REP_DEMOTE_THRESHOLD) return 0
	return Math.round((SOCIAL_REP_DEMOTE_THRESHOLD - score) * 1_000_000)
}
