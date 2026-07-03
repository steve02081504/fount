import { listReplicaUsernamesFollowing as listFollowersFromIndex } from '../../../../../scripts/p2p/social/follower_index.mjs'
import { applyFollowNetworkHints } from '../../../../../scripts/p2p/social/network_hints.mjs'
import { resolveOperatorEntityHashForUser as resolveOperatorEntityHash } from '../../../../../server/p2p_server/operator_identity.mjs'

import { commitTimelineEvent } from './timeline/append.mjs'
import { getTimelineMaterialized } from './timeline/materialize.mjs'

/**
 * 从 acting 实体时间线物化视图读取关注列表。
 * @param {string} username 用户
 * @param {string} actingEntityHash 写操作 acting 实体
 * @returns {Promise<{ following: string[] }>} 关注列表
 */
export async function loadFollowingForActor(username, actingEntityHash) {
	const actor = String(actingEntityHash || '').trim().toLowerCase()
	if (!actor) return { following: [] }
	const view = await getTimelineMaterialized(username, actor)
	const following = new Set(view.following.map(id => id.toLowerCase()))
	following.add(actor)
	return { following: [...following] }
}

/**
 * 从操作者时间线物化视图读取关注列表（默认 operator）。
 * @param {string} username 用户
 * @returns {Promise<{ following: string[] }>} 关注列表
 */
export async function loadFollowing(username) {
	const operator = await resolveOperatorEntityHash(username)
	if (!operator) return { following: [] }
	return loadFollowingForActor(username, operator)
}

/**
 * 关注或取关：追加 follow/unfollow 事件、联邦 fanout、网络 hint。
 * @param {string} username 用户
 * @param {string} actingEntityHash acting 实体（operator 或本地 agent）
 * @param {string} entityHash 目标
 * @param {boolean} follow true=关注 false=取关
 * @returns {Promise<string[]>} 规范化后的关注列表
 */
export async function setFollow(username, actingEntityHash, entityHash, follow) {
	const self = String(actingEntityHash || '').trim().toLowerCase()
	if (!self) throw new Error('configure federation identity before following')
	const id = entityHash.toLowerCase()
	const { following } = await loadFollowingForActor(username, self)
	const already = following.includes(id)
	if (follow === already) return following

	await commitTimelineEvent(username, self, {
		type: follow ? 'follow' : 'unfollow',
		content: {
			targetEntityHash: id,
		},
	})
	applyFollowNetworkHints(username, id, follow)
	if (follow) return [...following, id]
	return following.filter(hash => hash !== id)
}

export { listFollowersFromIndex as listReplicaUsernamesFollowing }
