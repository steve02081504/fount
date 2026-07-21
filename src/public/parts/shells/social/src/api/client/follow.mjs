import {
	setPersonalHidden,
	setPersonalMuted,
} from 'npm:@steve02081504/fount-p2p/node/personal_block'

import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { getEntityActivePubKey } from '../../../../chat/src/entity/identity.mjs'
import { dispatchFollowEvent } from '../../dispatch.mjs'
import { resolveSocialEntity } from '../../federation/hosting.mjs'
import { setFollow } from '../../following.mjs'
import { ensureEntitySocialReady } from '../../lib/bootstrap.mjs'
import { isKnownSocialTarget } from '../../lib/entityTarget.mjs'
import { setPersonalBlock } from '../../personalBlock.mjs'
import { commitTimelineEvent } from '../../timeline/append.mjs'
import { syncTimelineForEntity } from '../../timeline/sync.mjs'
import { autoApproveFollower } from '../../vault_crypto/followApprove.mjs'
import { buildFollowApprovePayload } from '../../vault_crypto/vault.mjs'

import { normalizeTarget, requireKnownTarget } from './helpers.mjs'

/**
 * @param {import('./helpers.mjs').SocialApiContext} apiContext API 上下文
 * @returns {object} 关注 / 拉黑 / 隐藏 / 静音方法
 */
export function createFollowMethods(apiContext) {
	return {
		/**
		 * @param {string} target 目标 entityHash
		 * @returns {Promise<object>} 关系结果
		 */
		async follow(target) {
			return setFollowRelation(apiContext, target, true)
		},
		/**
		 * @param {string} target 目标 entityHash
		 * @returns {Promise<object>} 关系结果
		 */
		async unfollow(target) {
			return setFollowRelation(apiContext, target, false)
		},
		/**
		 * @param {string} target 目标 entityHash
		 * @returns {Promise<object>} 关系结果
		 */
		async block(target) {
			return setBlockRelation(apiContext, target, true)
		},
		/**
		 * @param {string} target 目标 entityHash
		 * @returns {Promise<object>} 关系结果
		 */
		async unblock(target) {
			return setBlockRelation(apiContext, target, false)
		},
		/**
		 * @param {string} target 目标 entityHash
		 * @returns {Promise<object>} 关系结果
		 */
		async hide(target) {
			const hash = await requireKnownTarget(apiContext, target)
			const hidden = await setPersonalHidden(apiContext.entityHash, hash, true)
			return { entityHash: hash, hidden }
		},
		/**
		 * @param {string} target 目标 entityHash
		 * @returns {Promise<object>} 关系结果
		 */
		async unhide(target) {
			const hash = await requireKnownTarget(apiContext, target)
			const hidden = await setPersonalHidden(apiContext.entityHash, hash, false)
			return { entityHash: hash, hidden }
		},
		/**
		 * @param {string} target 目标 entityHash
		 * @returns {Promise<object>} 关系结果
		 */
		async mute(target) {
			const hash = await requireKnownTarget(apiContext, target)
			await setPersonalMuted(apiContext.entityHash, hash, true)
			return { entityHash: hash, muted: true }
		},
		/**
		 * @param {string} target 目标 entityHash
		 * @returns {Promise<object>} 关系结果
		 */
		async unmute(target) {
			const hash = await requireKnownTarget(apiContext, target)
			await setPersonalMuted(apiContext.entityHash, hash, false)
			return { entityHash: hash, muted: false }
		},
		/**
		 * @param {string} follower 关注者 Ed25519 pubKeyHex
		 * @returns {Promise<object>} follow_approve 事件
		 */
		async approveFollow(follower) {
			const followerPubKeyHex = String(follower)
			const payload = await buildFollowApprovePayload(apiContext.username, apiContext.entityHash, followerPubKeyHex)
			return commitTimelineEvent(apiContext.username, apiContext.entityHash, {
				type: 'follow_approve',
				content: payload,
			})
		},
	}
}

/**
 * @param {import('./helpers.mjs').SocialApiContext} apiContext 上下文
 * @param {string} target 目标
 * @param {boolean} follow 关注/取关
 * @returns {Promise<object>} 关系结果
 */
async function setFollowRelation(apiContext, target, follow) {
	const hash = normalizeTarget(target)
	await setFollow(apiContext.username, apiContext.entityHash, hash, follow)
	if (follow) {
		await dispatchFollowEvent(apiContext.username, apiContext.entityHash, hash)
		const targetEntity = await resolveSocialEntity(hash)
		if (targetEntity?.local && targetEntity.replicaUsername) {
			const followerPubKeyHex = await getEntityActivePubKey(apiContext.username, apiContext.entityHash)
			if (followerPubKeyHex)
				await autoApproveFollower(targetEntity.replicaUsername, hash, followerPubKeyHex)
		}
		await syncTimelineForEntity(apiContext.username, hash)
	}
	return { entityHash: hash, isFollowing: follow }
}

/**
 * @param {import('./helpers.mjs').SocialApiContext} apiContext 上下文
 * @param {string} target 目标
 * @param {boolean} block 拉黑/解除
 * @returns {Promise<object>} 关系结果
 */
async function setBlockRelation(apiContext, target, block) {
	const hash = normalizeTarget(target)
	if (!await isKnownSocialTarget(apiContext.username, hash))
		throw httpError(400, 'unknown entity')
	await ensureEntitySocialReady(apiContext.username, apiContext.entityHash)
	await setPersonalBlock(apiContext.username, apiContext.entityHash, hash, block)
	return { entityHash: hash, blocked: block }
}
