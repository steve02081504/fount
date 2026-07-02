import { isEntityHashBlocked } from '../../../../../scripts/p2p/denylist.mjs'
import { getProfile } from '../../../../../scripts/p2p/entity/profile.mjs'
import { isEntityHash128 } from '../../../../../scripts/p2p/entity_id.mjs'
import {
	isAuthorFilteredByPersonalSets,
} from '../../../../../scripts/p2p/personal_block.mjs'
import { pickNodeScore, reputationSortPenalty, shouldHideAuthorByReputation } from '../../../../../scripts/p2p/reputation.mjs'

import {
	buildPostFeedItem,
	buildRepostFeedItem,
	createEngagementForPost,
	withDecryptedPostContent,
} from './feed/buildItem.mjs'
import {
	buildEngagementIndex,
	buildViewerLikedSet,
	listKnownTimelineOwners,
	loadViewerContext,
} from './feedHelpers.mjs'
import { compareFeedItems, kWayMergeFeedStreams, pickNextFeedStreamIndex } from './feedMerge.mjs'
import { canViewPost } from './feedVisibility.mjs'
import { loadFollowing } from './following.mjs'
import { createAuthorProfileLoader } from './lib/authorProfileSummary.mjs'
import { getTimelineMaterialized } from './timeline/materialize.mjs'

/**
 * @param {string} entityHash 作者实体
 * @returns {boolean} 是否因信誉隐藏
 */
function isHiddenByAuthorReputation(entityHash) {
	return shouldHideAuthorByReputation(entityHash, pickNodeScore)
}

/**
 * 解析并校验对观看者可见的帖子（含解密）。
 * @param {string} username 用户
 * @param {string} entityHash 作者
 * @param {string} postId 帖子 id
 * @param {object} viewerContext 观看者上下文
 * @returns {Promise<object | null>} 可见帖子或 null
 */
async function resolveVisiblePost(username, entityHash, postId, viewerContext) {
	const view = await getTimelineMaterialized(username, entityHash)
	if (!view.posts?.length && !view.postById) return null
	const post = view.postById?.[postId]
	if (!post) return null
	const enriched = { ...post, entityHash }
	if (!canViewPost(enriched, viewerContext))
		return null
	return withDecryptedPostContent(username, entityHash, post)
}

/**
 * 构建关注流首页 feed（含原帖与转发，多路归并排序）。
 * @param {string} username 用户
 * @param {object} [options] 分页选项
 * @param {number} [options.limit=50] 条数上限
 * @param {string} [options.cursor] 分页游标
 * @returns {Promise<{ items: object[], nextCursor: string | null }>} 首页 feed
 */
export async function buildHomeFeed(username, options = {}) {
	const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200)
	const { following } = await loadFollowing(username)
	const viewerContext = await loadViewerContext(username)
	const feedSources = new Set(following)

	const engagement = await buildEngagementIndex(username, feedSources)
	const viewerLiked = await buildViewerLikedSet(username)
	const authorProfile = createAuthorProfileLoader(username)
	const engagementForPost = createEngagementForPost(engagement, viewerLiked)
	const feedItemBuildContext = { authorProfile, engagementForPost }

	/** @type {{ candidates: object[], index: number }[]} */
	const streams = []
	for (const entityHash of feedSources) {
		if (!isEntityHash128(entityHash)) continue
		if (isEntityHashBlocked(entityHash)) continue
		if (isHiddenByAuthorReputation(entityHash)) continue
		const view = await getTimelineMaterialized(username, entityHash)
		if (!view.posts?.length && !view.reposts?.length) continue
		/** @type {object[]} */
		const candidates = []
		for (const post of view.posts) {
			const enriched = { ...post, entityHash }
			if (!canViewPost(enriched, viewerContext))
				continue
			candidates.push({
				kind: 'post',
				entityHash,
				postId: post.id,
				post,
				hlc: post.hlc,
				repPenalty: reputationSortPenalty(entityHash, pickNodeScore),
			})
		}
		for (const repost of view.reposts) {
			const originalEntityHash = (repost.content?.targetEntityHash || '').toLowerCase()
			const originalPostId = repost.content?.targetPostId || ''
			if (!isEntityHash128(originalEntityHash) || !originalPostId) continue
			candidates.push({
				kind: 'repost',
				entityHash,
				postId: repost.id,
				hlc: repost.hlc,
				repost,
				originalEntityHash,
				originalPostId,
				repPenalty: reputationSortPenalty(entityHash, pickNodeScore),
			})
		}
		candidates.sort((a, b) => -compareFeedItems(a, b))
		streams.push({ candidates, index: 0 })
	}

	let collecting = !options.cursor
	/** @type {object[]} */
	const items = []
	let hasMore = false

	while (collecting ? items.length < limit : true) {
		const best = pickNextFeedStreamIndex(streams)
		if (best < 0) break

		const stream = streams[best]
		const candidate = stream.candidates[stream.index]
		stream.index++

		/** @type {object | null} */
		let item = null
		if (candidate.kind === 'repost') {
			const originalPost = await resolveVisiblePost(username, candidate.originalEntityHash, candidate.originalPostId, viewerContext)
			if (originalPost)
				item = await buildRepostFeedItem(candidate, originalPost, feedItemBuildContext)
		}
		else
			item = await buildPostFeedItem(username, candidate.entityHash, candidate.post, feedItemBuildContext)

		if (!item) continue
		const key = `${item.entityHash}:${item.postId}`
		if (!collecting) {
			if (key === options.cursor) collecting = true
			continue
		}
		items.push(item)
	}

	if (items.length === limit) {
		const peek = kWayMergeFeedStreams(streams.map(s => ({ ...s })), 1)
		hasMore = peek.length > 0
	}

	const next = hasMore && items.length
		? `${items[items.length - 1].entityHash}:${items[items.length - 1].postId}`
		: null
	return { items, nextCursor: next }
}

/**
 * 构建资料页帖子列表（与首页 feed 同构）。
 * @param {string} username 用户
 * @param {string} entityHash 资料页 owner
 * @returns {Promise<{ entityHash: string, items: object[] }>} 与首页 feed 同构的帖子列表
 */
export async function buildProfileFeedItems(username, entityHash) {
	entityHash = entityHash.trim().toLowerCase()
	if (!isEntityHash128(entityHash))
		return { entityHash, items: [] }

	const viewerContext = await loadViewerContext(username)
	const engagement = await buildEngagementIndex(username)
	const viewerLiked = await buildViewerLikedSet(username)
	const authorProfile = createAuthorProfileLoader(username)
	const engagementForPost = createEngagementForPost(engagement, viewerLiked)
	const feedItemBuildContext = { authorProfile, engagementForPost }

	const view = await getTimelineMaterialized(username, entityHash)
	if (!view.posts?.length)
		return { entityHash, items: [] }

	/** @type {object[]} */
	const items = []

	for (const post of view.posts) {
		const enriched = { ...post, entityHash }
		if (!canViewPost(enriched, viewerContext))
			continue
		items.push(await buildPostFeedItem(username, entityHash, post, feedItemBuildContext))
	}

	items.sort((left, right) => compareFeedItems(left, right) * -1)
	return { entityHash, items }
}

/**
 * 构建资料页点赞列表（与首页 feed 同构）。
 * @param {string} username 用户
 * @param {string} entityHash 资料页 owner
 * @returns {Promise<{ entityHash: string, items: object[] }>} 点赞过的帖子列表
 */
export async function buildLikedFeedItems(username, entityHash) {
	entityHash = entityHash.trim().toLowerCase()
	if (!isEntityHash128(entityHash))
		return { entityHash, items: [] }

	const viewerContext = await loadViewerContext(username)
	const engagement = await buildEngagementIndex(username)
	const viewerLiked = await buildViewerLikedSet(username)
	const authorProfile = createAuthorProfileLoader(username)
	const engagementForPost = createEngagementForPost(engagement, viewerLiked)
	const feedItemBuildContext = { authorProfile, engagementForPost }

	const view = await getTimelineMaterialized(username, entityHash)
	if (!view.likes?.length)
		return { entityHash, items: [] }

	/** @type {object[]} */
	const items = []

	for (const like of view.likes) {
		const targetEntityHash = (like.content?.targetEntityHash || '').toLowerCase()
		const targetPostId = like.content?.targetPostId
		if (!isEntityHash128(targetEntityHash) || targetPostId == null) continue
		const post = await resolveVisiblePost(username, targetEntityHash, String(targetPostId), viewerContext)
		if (!post) continue
		items.push(await buildPostFeedItem(username, targetEntityHash, post, feedItemBuildContext))
	}

	items.sort((left, right) => compareFeedItems(left, right) * -1)
	return { entityHash, items }
}

/**
 * 列出指定帖子的可见回复。
 * @param {string} username 用户
 * @param {string} entityHash 作者
 * @param {string} postId 帖子
 * @returns {Promise<object[]>} 可见回复
 */
export async function listReplies(username, entityHash, postId) {
	const viewerContext = await loadViewerContext(username)
	/** @type {object[]} */
	const replies = []

	for (const author of await listKnownTimelineOwners(username)) {
		if (isAuthorFilteredByPersonalSets(viewerContext.personalFilter, author)) continue
		if (isHiddenByAuthorReputation(author)) continue
		const view = await getTimelineMaterialized(username, author)
		if (!view.posts?.length) continue
		for (const post of view.posts) {
			const replyTo = post.content?.replyTo
			if (!replyTo) continue
			if (replyTo.entityHash?.toLowerCase() !== entityHash.toLowerCase()) continue
			if (replyTo.postId !== postId) continue
			if (!canViewPost({ ...post, entityHash: author }, viewerContext))
				continue
			replies.push({ entityHash: author, post })
		}
	}

	replies.sort((left, right) => {
		const lw = Number(left.post.hlc.wall)
		const rw = Number(right.post.hlc.wall)
		return rw - lw
	})
	return replies
}

/**
 * 获取 entity 的 Chat profile（必要时自动创建本地资料）。
 * @param {string} username 用户
 * @param {string} entityHash 目标
 * @returns {Promise<object | null>} chat entities profile
 */
export async function getEntityProfile(username, entityHash) {
	if (!isEntityHash128(entityHash)) return null
	// getProfile 对本地实体会自动落盘创建，对远端实体返回派生默认资料；
	// 不可用 ensureLocalEntityProfile（其对非本地实体抛错），否则查看远端账户会 500。
	return getProfile(entityHash, username)
}
