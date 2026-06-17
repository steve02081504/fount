import { resolveOperatorEntityHash } from './lib/operatorEntity.mjs'
import { listReplicaUsernamesFollowing as listFollowersFromIndex } from '../../../../../scripts/p2p/social/follower_index.mjs'
import { applyFollowNetworkHints } from '../../../../../scripts/p2p/social/network_hints.mjs'

import { commitTimelineEvent } from './timeline/append.mjs'
import { getTimelineMaterialized } from './timeline/materialize.mjs'

/**
 * 从操作者时间线物化视图读取关注列表。
 * @param {string} username 用户
 * @returns {Promise<{ following: string[] }>} 关注列表
 */
export async function loadFollowing(username) {
	const operator = await resolveOperatorEntityHash(username)
	if (!operator) return { following: [] }
	const view = await getTimelineMaterialized(username, operator)
	return { following: view.following.map(id => id.toLowerCase()) }
}

/**
 * 关注或取关：追加 follow/unfollow 事件、联邦 fanout、网络 hint。
 * @param {string} username 用户
 * @param {string} entityHash 目标
 * @param {boolean} follow true=关注 false=取关
 * @param {{ rep_edge?: number }} [options] follow 事件可选 rep_edge
 * @returns {Promise<string[]>} 规范化后的关注列表
 */
export async function setFollow(username, entityHash, follow, options = {}) {
	const self = await resolveOperatorEntityHash(username)
	if (!self) throw new Error('configure federation identity before following')
	const id = entityHash.toLowerCase()
	const { following } = await loadFollowing(username)
	const already = following.includes(id)
	if (follow === already) return following

	await commitTimelineEvent(username, self, {
		type: follow ? 'follow' : 'unfollow',
		content: {
			targetEntityHash: id,
			...follow ? { rep_edge: Number(options.rep_edge) || 1 } : {},
		},
	})
	applyFollowNetworkHints(username, id, follow)
	if (follow) return [...following, id]
	return following.filter(hash => hash !== id)
}

/**
 *
 */
export { listFollowersFromIndex as listReplicaUsernamesFollowing }
