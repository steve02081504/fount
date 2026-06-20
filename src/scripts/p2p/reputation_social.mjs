import { parseEntityHash } from './entity_id.mjs'
import socialTunables from './reputation_social.tunables.json' with { type: 'json' }
import {
	applyFollowedBlockSignalPure,
	applyFollowedSuspectSignalPure,
	applySocialBlockDecayAllPure,
	reputationSortPenaltyFromScore,
	shouldHideByScore,
} from './reputation_social_engine.mjs'

/** 公开拉黑主张强度 */
export const SOCIAL_BLOCK_CLAIM = socialTunables.socialBlockClaim

/** feed/搜索：低于此分直接隐藏作者 */
export const SOCIAL_REP_HIDE_THRESHOLD = socialTunables.socialRepHideThreshold

/** feed：低于此分降权排序 */
export const SOCIAL_REP_DEMOTE_THRESHOLD = socialTunables.socialRepDemoteThreshold

/** 单条 social block 记账温和衰减窗口（毫秒） */
export const SOCIAL_BLOCK_DECAY_MS = socialTunables.socialBlockDecayMs

/** 每个衰减窗口回补比例（对已记账 penalty 的一部分） */
export const SOCIAL_BLOCK_DECAY_FRACTION = socialTunables.socialBlockDecayFraction

/**
 * @param {import('./reputation_store.mjs').ReputationFile} data 信誉表
 * @returns {void}
 */
export function applySocialBlockDecayAll(data) {
	applySocialBlockDecayAllPure(data)
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

	await mutateReputation(data => {
		applyFollowedBlockSignalPure(data, {
			followerNodeHash: follower.nodeHash,
			targetNodeHash: target.nodeHash,
			voterKey: follower.entityHash,
			action: opts.action,
			selfTrust: !!opts.selfTrust,
		})
	})
	return true
}

/**
 * @param {object} opts 参数
 * @param {string} opts.followerEntityHash 关注者（怀疑发起方）实体
 * @param {string} opts.targetEntityHash 被怀疑实体
 * @param {'suspect' | 'unsuspect'} opts.action 动作
 * @param {boolean} [opts.selfTrust] 自己声明时满信任权重
 * @param {(mutator: (data: import('./reputation_store.mjs').ReputationFile) => void | Promise<void>) => Promise<void>} mutateReputation 突变器
 * @returns {Promise<boolean>} 是否已应用
 */
export async function applyFollowedSuspectSignal(opts, mutateReputation) {
	const follower = parseEntityHash(opts.followerEntityHash)
	const target = parseEntityHash(opts.targetEntityHash)
	if (!follower || !target) return false

	await mutateReputation(data => {
		applyFollowedSuspectSignalPure(data, {
			followerNodeHash: follower.nodeHash,
			targetNodeHash: target.nodeHash,
			voterKey: follower.entityHash,
			action: opts.action,
			selfTrust: !!opts.selfTrust,
		})
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
	return shouldHideByScore(scoreOf(parsed.nodeHash))
}

/**
 * @param {string} entityHash 作者实体
 * @param {(nodeId: string) => number} scoreOf 取分函数
 * @returns {number} 排序惩罚（越大越靠后）
 */
export function reputationSortPenalty(entityHash, scoreOf) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed) return 0
	return reputationSortPenaltyFromScore(scoreOf(parsed.nodeHash))
}
