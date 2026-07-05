import { loadPersonalFilterSets } from '../../../../../../scripts/p2p/personal_block.mjs'
import { socialPostKey } from '../../../../../../scripts/p2p/social/post_key.mjs'
import { resolveOperatorEntityHashForUser as resolveOperatorEntityHash } from '../../../../../../server/p2p_server/operator_identity.mjs'
import { loadFollowing, loadFollowingForActor } from '../following.mjs'
import { getTimelineMaterialized } from '../timeline/materialize.mjs'
import { getTimelineOwnerIndex, listLocalEntitiesForNode } from '../timeline/ownerIndex.mjs'

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
 * 列出观看者已知的时间线 owner（关注 + 自身；自身由隐式自关注保证）。
 * @param {string} username 用户
 * @returns {Promise<string[]>} 已知时间线 owner
 */
export async function listKnownTimelineOwners(username) {
	const { following } = await loadFollowing(username)
	return following
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
 * @returns {Promise<{ likes: Map<string, number>, reposts: Map<string, number>, replies: Map<string, number> }>} 互动计数索引
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
 * @returns {Promise<Set<string>>} 已点赞帖子键集合
 */
export async function buildViewerLikedSet(username) {
	const self = await resolveOperatorEntityHash(username)
	if (!self) return new Set()
	const view = await getTimelineMaterialized(username, self)
	return new Set(view.likes.map(like =>
		socialPostKey(like.content.targetEntityHash, like.content.targetPostId),
	))
}

/**
 * @param {string} username 用户
 * @param {string} [viewerEntityHash] 可选指定观看实体，默认 operator
 * @returns {Promise<{ viewerEntityHash: string | null, following: Set<string>, personalFilter: Awaited<ReturnType<typeof loadPersonalFilterSets>> }>} 观看者上下文
 */
export async function loadViewerContext(username, viewerEntityHash = null) {
	const viewer = viewerEntityHash || await resolveOperatorEntityHash(username)
	const following = new Set(
		viewer
			? (await loadFollowingForActor(username, viewer)).following.map(id => id.toLowerCase())
			: [],
	)
	const personalFilter = viewer
		? await loadPersonalFilterSets(viewer)
		: {
			blockedEntityHashes: new Set(),
			blockedSubjects: new Set(),
			hiddenEntityHashes: new Set(),
			hiddenSubjects: new Set(),
		}
	return { viewerEntityHash: viewer, following, personalFilter }
}
