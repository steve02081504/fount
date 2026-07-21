import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import {
	applyFollowedBlockSignalPure,
	reputationSortPenaltyFromScore,
	shouldHideByScore,
} from './engine.mjs'
import socialTunables from './tunables.json' with { type: 'json' }

/** 公开拉黑主张强度 */
export const SOCIAL_BLOCK_CLAIM = socialTunables.socialBlockClaim

/** feed/搜索：低于此分直接隐藏作者 */
export const SOCIAL_REP_HIDE_THRESHOLD = socialTunables.socialRepHideThreshold

/** feed：低于此分降权排序 */
export const SOCIAL_REP_DEMOTE_THRESHOLD = socialTunables.socialRepDemoteThreshold

/**
 * @param {object} options 参数
 * @param {string} options.followerEntityHash 关注者（拉黑发起方）实体
 * @param {string} options.targetEntityHash 被拉黑实体
 * @param {'block' | 'unblock'} options.action 动作
 * @param {boolean} [options.selfTrust] 自己拉黑时满信任权重
 * @param {(mutator: (data: import('npm:@steve02081504/fount-p2p/node/reputation_store').ReputationFile) => void | Promise<void>) => Promise<void>} mutateReputation 突变器
 * @returns {Promise<boolean>} 是否已应用
 */
export async function applyFollowedBlockSignal(options, mutateReputation) {
	const follower = parseEntityHash(options.followerEntityHash)
	const target = parseEntityHash(options.targetEntityHash)
	if (!follower || !target) return false

	await mutateReputation(data => {
		applyFollowedBlockSignalPure(data, {
			followerNodeHash: follower.nodeHash,
			targetNodeHash: target.nodeHash,
			voterKey: follower.entityHash,
			action: options.action,
			selfTrust: !!options.selfTrust,
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
