import { commitTimelineEvent } from '../timeline/append.mjs'

import { buildFollowApprovePayload } from './vault.mjs'

/**
 * 为关注者签发 follow_approve 并 fanout（本机托管的时间线 owner）。
 * @param {string} replicaUsername owner 所在 replica
 * @param {string} ownerEntityHash 时间线 owner
 * @param {string} followerPubKeyHex 关注者 Ed25519 公钥 hex
 * @returns {Promise<object>} 签名事件
 */
export async function autoApproveFollower(replicaUsername, ownerEntityHash, followerPubKeyHex) {
	const payload = await buildFollowApprovePayload(replicaUsername, ownerEntityHash, followerPubKeyHex)
	return commitTimelineEvent(replicaUsername, ownerEntityHash, {
		type: 'follow_approve',
		content: payload,
	})
}
