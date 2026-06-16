import { loadBlocklist } from '../../../../../scripts/p2p/blocklist.mjs'
import { resolveOperatorEntityHash } from '../../../../../scripts/p2p/entity/replica.mjs'
import { socialPostKey } from '../../../../../scripts/p2p/social/post_key.mjs'

import { getTimelineMaterialized } from './timeline/materialize.mjs'
import { getTimelineOwnerIndex, listLocalEntitiesForNode } from './timeline/ownerIndex.mjs'

/**
 * 列出磁盘上全部时间线 owner（探索/热搜用）。
 * @param {string} username 用户
 * @param {{ nodeHashPrefix?: string | null }} [options] 仅返回该 nodeHash 托管的 entity
 * @returns {Promise<string[]>} 本地 timelines 目录下的 entityHash
 */
export async function listLocalTimelineOwners(username, options = {}) {
	const prefix = (options.nodeHashPrefix || '').trim().toLowerCase() || null
	if (prefix) return listLocalEntitiesForNode(username, prefix)
	return [...(await getTimelineOwnerIndex(username)).all]
}

/**
 * 列出观看者已知的时间线 owner（关注 + 自身）。
 * @param {string} username 用户
 * @returns {Promise<string[]>} 已知时间线 owner
 */
export async function listKnownTimelineOwners(username) {
	const operator = resolveOperatorEntityHash(username)
	if (!operator) return []
	const view = await getTimelineMaterialized(username, operator)
	const set = new Set(view.following.map(id => id.toLowerCase()))
	set.add(operator.toLowerCase())
	return [...set]
}

/**
 * @param {string} username 用户
 * @param {'known' | 'local'} [scope='known'] known=关注+自己；local=磁盘全部
 * @returns {Promise<string[]>} 时间线 owner 列表
 */
export async function listTimelineOwners(username, scope = 'known') {
	return scope === 'local'
		? listLocalTimelineOwners(username)
		: listKnownTimelineOwners(username)
}

/**
 * 根据可见性与拉黑/关注关系判断帖子是否对观看者可见。
 * @param {object} post 帖子
 * @param {string | null} viewerEntityHash 观看者 entityHash
 * @param {Set<string>} blocked 拉黑集合
 * @param {Set<string>} following 观看者关注列表
 * @returns {boolean} 是否可见
 */
export function canViewPost(post, viewerEntityHash, blocked, following) {
	const authorEntity = post.entityHash.toLowerCase()
	if (blocked.has(authorEntity)) return false
	if (viewerEntityHash && authorEntity === viewerEntityHash.toLowerCase()) return true
	const visibility = post.content?.visibility || 'public'
	if (visibility === 'public') return true
	if (visibility === 'followers') return following.has(authorEntity)
	return false
}

/**
 * @param {Map<string, number>} counts 计数表
 * @param {string} entityHash 目标实体
 * @param {string | number} postId 帖子 id
 */
function bumpEngagementCount(counts, entityHash, postId) {
	if (!entityHash || postId == null) return
	const key = socialPostKey(entityHash.toLowerCase(), postId)
	counts.set(key, (counts.get(key) || 0) + 1)
}

/**
 * 扫描时间线构建点赞/转发/回复计数索引。
 * @param {string} username 用户
 * @param {Iterable<string>} [owners] 仅扫描这些时间线 owner；缺省为全部已知 owner
 * @returns {Promise<{ likes: Map<string, number>, reposts: Map<string, number>, replies: Map<string, number> }>} 各帖子键的点赞/转发/回复计数
 */
export async function buildEngagementIndex(username, owners = null) {
	/** @type {Map<string, number>} */
	const likes = new Map()
	/** @type {Map<string, number>} */
	const reposts = new Map()
	/** @type {Map<string, number>} */
	const replies = new Map()

	const ownerList = owners ? [...owners] : await listKnownTimelineOwners(username)
	for (const owner of ownerList) {
		const view = await getTimelineMaterialized(username, owner)
		for (const like of view.likes)
			bumpEngagementCount(likes, like.content?.targetEntityHash, like.content?.targetPostId)
		for (const repost of view.reposts)
			bumpEngagementCount(reposts, repost.content?.targetEntityHash, repost.content?.targetPostId)
		for (const post of view.posts) {
			const replyTo = post.content?.replyTo
			bumpEngagementCount(replies, replyTo?.entityHash, replyTo?.postId)
		}
	}
	return { likes, reposts, replies }
}

/**
 * 收集观看者已点赞的帖子键集合。
 * @param {string} username 用户
 * @returns {Promise<Set<string>>} 观看者已点赞的 `entityHash:postId` 键集合
 */
export async function buildViewerLikedSet(username) {
	const self = resolveOperatorEntityHash(username)
	if (!self) return new Set()
	const view = await getTimelineMaterialized(username, self)
	return new Set(view.likes.map(like =>
		socialPostKey(like.content.targetEntityHash, like.content.targetPostId),
	))
}

/**
 * @param {string} username 用户
 * @returns {Promise<{ viewerEntityHash: string | null, blocked: Set<string>, following: Set<string> }>} 观看者上下文
 */
export async function loadViewerContext(username) {
	const viewerEntityHash = resolveOperatorEntityHash(username)
	const blocked = new Set(
		loadBlocklist(username).blocked
			.filter(entry => entry.scope === 'entity')
			.map(entry => entry.value),
	)
	const following = new Set(
		viewerEntityHash
			? (await getTimelineMaterialized(username, viewerEntityHash)).following.map(id => id.toLowerCase())
			: [],
	)
	return { viewerEntityHash, blocked, following }
}
