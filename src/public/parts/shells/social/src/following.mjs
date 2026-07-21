import { resolveOperatorEntityHashForUser as resolveOperatorEntityHash } from '../../chat/src/entity/identity.mjs'

import { applyFollowNetworkHints } from './federation/network_hints.mjs'
import { commitTimelineEvent } from './timeline/append.mjs'
import { getTimelineMaterialized } from './timeline/materialize.mjs'

/**
 * 从实体时间线物化视图读取关注列表。
 * @param {string} username 用户
 * @param {string} entityHash 观看/写操作实体
 * @returns {Promise<{ following: string[] }>} 关注列表
 */
export async function loadFollowingForActor(username, entityHash) {
	const actor = String(entityHash || '').trim().toLowerCase()
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
 * @param {string} entityHash 发起方实体（operator 或本地 agent）
 * @param {string} targetEntityHash 目标
 * @param {boolean} follow true=关注 false=取关
 * @returns {Promise<string[]>} 规范化后的关注列表
 */
export async function setFollow(username, entityHash, targetEntityHash, follow) {
	const self = String(entityHash || '').trim().toLowerCase()
	if (!self) throw new Error('configure federation identity before following')
	const id = String(targetEntityHash).toLowerCase()
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

/**
 * 列出观看者已知的时间线 owner（关注 + 自身；自身由隐式自关注保证）。
 * @param {string} username 用户
 * @param {string} [viewerEntityHash] 观看实体；缺省为 operator
 * @returns {Promise<string[]>} 已知时间线 owner
 */
export async function listFollowedTimelineOwners(username, viewerEntityHash) {
	const viewer = viewerEntityHash
		? String(viewerEntityHash).trim().toLowerCase()
		: await resolveOperatorEntityHash(username)
	if (!viewer) return []
	const { following } = await loadFollowingForActor(username, viewer)
	return following
}
