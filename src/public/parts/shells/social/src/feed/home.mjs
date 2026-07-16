import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isEntityHashBlocked } from 'npm:@steve02081504/fount-p2p/node/denylist'
import {
	isAuthorFilteredByPersonalSets,
	loadPersonalFilterSets,
} from 'npm:@steve02081504/fount-p2p/node/personal_block'
import { pickNodeScore } from 'npm:@steve02081504/fount-p2p/node/reputation_store'

import { resolveOperatorEntityHashForUser as resolveOperatorEntityHash } from '../../../chat/src/entity/identity.mjs'
import { socialPostKey } from '../federation/post_key.mjs'
import { reputationSortPenalty, shouldHideAuthorByReputation } from '../federation/reputation/index.mjs'
import { compareFeedItems, kWayMergeFeedStreams, pickNextFeedStreamIndex } from '../feedMerge.mjs'
import { canViewPost } from '../feedVisibility.mjs'
import { loadFollowing, loadFollowingForActor, listFollowedTimelineOwners } from '../following.mjs'
import { loadMutedKeywords } from '../mutedKeywords.mjs'
import { queryReplyIndex } from '../searchIndex.mjs'
import { getTimelineMaterialized } from '../timeline/materialize.mjs'

import {
	buildPostFeedItem,
	buildRepostFeedItem,
	withDecryptedPostContent,
} from './buildItem.mjs'
import { createFeedItemBuildContext } from './iterate.mjs'

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
 * 扫描时间线构建点赞/点踩/转发/回复计数索引。
 * @param {string} username 用户
 * @param {Iterable<string>} [owners] 仅扫描这些时间线 owner；缺省为全部已知 owner
 * @returns {Promise<{ likes: Map<string, number>, dislikes: Map<string, number>, reposts: Map<string, number>, replies: Map<string, number> }>} 互动计数索引
 */
export async function buildEngagementIndex(username, owners = null) {
	/** @type {Map<string, number>} */
	const likes = new Map()
	/** @type {Map<string, number>} */
	const dislikes = new Map()
	/** @type {Map<string, number>} */
	const reposts = new Map()
	/** @type {Map<string, number>} */
	const replies = new Map()

	const ownerList = owners ? [...owners] : await listFollowedTimelineOwners(username)
	for (const owner of ownerList) {
		const view = await getTimelineMaterialized(username, owner)
		for (const like of view.likes || [])
			bumpEngagementCount(likes, like.content?.targetEntityHash, like.content?.targetPostId)
		for (const dislike of view.dislikes || [])
			bumpEngagementCount(dislikes, dislike.content?.targetEntityHash, dislike.content?.targetPostId)
		for (const repost of view.reposts || [])
			bumpEngagementCount(reposts, repost.content?.targetEntityHash, repost.content?.targetPostId)
		for (const post of view.posts || []) {
			const replyTo = post.content?.replyTo
			bumpEngagementCount(replies, replyTo?.entityHash, replyTo?.postId)
		}
	}
	return { likes, dislikes, reposts, replies }
}

/**
 * 收集观看者已点赞的帖子键集合。
 * @param {string} username 用户
 * @param {string} [viewerEntityHash] 观看实体；缺省为 operator
 * @returns {Promise<Set<string>>} 已点赞帖子键集合
 */
export async function buildViewerLikedSet(username, viewerEntityHash) {
	const self = viewerEntityHash
		? String(viewerEntityHash).trim().toLowerCase()
		: await resolveOperatorEntityHash(username)
	if (!self) return new Set()
	const view = await getTimelineMaterialized(username, self)
	return new Set((view.likes || []).map(like =>
		socialPostKey(like.content.targetEntityHash, like.content.targetPostId),
	))
}

/**
 * 收集观看者已点踩的帖子键集合。
 * @param {string} username 用户
 * @param {string} [viewerEntityHash] 观看实体；缺省为 operator
 * @returns {Promise<Set<string>>} 已点踩帖子键集合
 */
export async function buildViewerDislikedSet(username, viewerEntityHash) {
	const self = viewerEntityHash
		? String(viewerEntityHash).trim().toLowerCase()
		: await resolveOperatorEntityHash(username)
	if (!self) return new Set()
	const view = await getTimelineMaterialized(username, self)
	return new Set((view.dislikes || []).map(dislike =>
		socialPostKey(dislike.content.targetEntityHash, dislike.content.targetPostId),
	))
}

/**
 * @param {string} username 用户
 * @param {string} [viewerEntityHash] 可选指定观看实体，默认 operator
 * @returns {Promise<{ viewerEntityHash: string | null, following: Set<string>, personalFilter: Awaited<ReturnType<typeof loadPersonalFilterSets>>, mutedKeywords: Awaited<ReturnType<typeof loadMutedKeywords>> }>} 观看者上下文
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
	const mutedKeywords = viewer
		? await loadMutedKeywords(username, viewer)
		: { entries: [] }
	return { viewerEntityHash: viewer, following, personalFilter, mutedKeywords }
}

/**
 * @param {object} item feed 条目
 * @returns {string} 分页游标（始终指向原帖 entityHash:postId）
 */
export function feedItemCursorKey(item) {
	if (item.kind === 'repost') {
		const originalEntity = item.targetEntityHash || item.post?.entityHash
		const originalPostId = item.targetPostId || item.post?.id
		if (originalEntity && originalPostId)
			return `${originalEntity}:${originalPostId}`
	}
	return `${item.entityHash}:${item.postId}`
}

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
	const post = (await getTimelineMaterialized(username, entityHash)).postById?.[postId]
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
 * @param {string} [options.viewerEntityHash] 观看实体；缺省 = operator
 * @param {number} [options.limit=50] 条数上限
 * @param {string} [options.cursor] 分页游标
 * @returns {Promise<{ items: object[], nextCursor: string | null }>} 首页 feed
 */
export async function buildHomeFeed(username, options = {}) {
	const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200)
	const viewer = options.viewerEntityHash || null
	const { following } = viewer
		? await loadFollowingForActor(username, viewer)
		: await loadFollowing(username)
	const viewerContext = await loadViewerContext(username, viewer)
	const feedSources = new Set(following)
	const itemContext = await createFeedItemBuildContext(username, feedSources, viewer)

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

	// 订阅话题源：从已知时间线注入含标签的公开帖
	if (viewer) {
		const viewerView = await getTimelineMaterialized(username, viewer)
		const followedTags = new Set((viewerView.followedTags || []).map(t => String(t).toLowerCase()))
		if (followedTags.size) {
			const { extractHashtagsFromText } = await import('../lib/hashtags.mjs')
			/** @type {object[]} */
			const topicCandidates = []
			const seenKeys = new Set()
			for (const entityHash of feedSources) {
				if (!isEntityHash128(entityHash)) continue
				const view = await getTimelineMaterialized(username, entityHash)
				for (const post of view.posts || []) {
					if (post.content?.visibility === 'followers') continue
					const tags = [
						...extractHashtagsFromText(post.content?.text || ''),
						...Array.isArray(post.content?.tags) ? post.content.tags.map(t => String(t).toLowerCase()) : [],
					]
					if (!tags.some(tag => followedTags.has(tag))) continue
					const key = `${entityHash}:${post.id}`
					if (seenKeys.has(key)) continue
					seenKeys.add(key)
					topicCandidates.push({
						kind: 'post',
						entityHash,
						postId: post.id,
						post,
						hlc: post.hlc,
						via: 'topic',
						repPenalty: reputationSortPenalty(entityHash, pickNodeScore),
					})
				}
			}
			if (topicCandidates.length) {
				topicCandidates.sort((a, b) => -compareFeedItems(a, b))
				streams.push({ candidates: topicCandidates, index: 0 })
			}
		}
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
				item = await buildRepostFeedItem(candidate, originalPost, itemContext)
		}
		else
			item = await buildPostFeedItem(username, candidate.entityHash, candidate.post, itemContext)

		if (!item) continue
		if (candidate.via) item.via = candidate.via
		const key = feedItemCursorKey(item)
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
		? feedItemCursorKey(items[items.length - 1])
		: null
	return { items, nextCursor: next }
}

/**
 * 构建资料页帖子列表（与首页 feed 同构，支持 cursor 分页）。
 * @param {string} username 用户
 * @param {string} entityHash 资料页 owner
 * @param {{ limit?: number, cursor?: string, viewerEntityHash?: string }} [options] 分页与观看者
 * @returns {Promise<{ entityHash: string, items: object[], nextCursor: string | null }>} 与首页 feed 同构的帖子列表
 */
export async function buildProfileFeedItems(username, entityHash, options = {}) {
	const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100)
	entityHash = entityHash.trim().toLowerCase()
	if (!isEntityHash128(entityHash))
		return { entityHash, items: [], nextCursor: null }

	const viewerContext = await loadViewerContext(username, options.viewerEntityHash || null)
	const itemContext = await createFeedItemBuildContext(username, null, options.viewerEntityHash || null)
	const view = await getTimelineMaterialized(username, entityHash)

	/** @type {object[]} */
	const items = []

	for (const post of view.posts) {
		const enriched = { ...post, entityHash }
		if (!canViewPost(enriched, viewerContext))
			continue
		items.push(await buildPostFeedItem(username, entityHash, post, itemContext))
	}

	items.sort((left, right) => compareFeedItems(left, right) * -1)

	let start = 0
	if (options.cursor) {
		const cursor = String(options.cursor).trim().toLowerCase()
		const index = items.findIndex(item => String(item.postId || '').toLowerCase() === cursor)
		start = index >= 0 ? index + 1 : 0
	}
	const page = items.slice(start, start + limit)
	const nextCursor = page.length === limit && start + limit < items.length
		? String(page[page.length - 1].postId)
		: null
	return { entityHash, items: page, nextCursor }
}

/**
 * 构建资料页点赞列表（与首页 feed 同构）。
 * @param {string} username 用户
 * @param {string} entityHash 资料页 owner
 * @param {{ viewerEntityHash?: string }} [options] 观看者
 * @returns {Promise<{ entityHash: string, items: object[] }>} 点赞过的帖子列表
 */
export async function buildLikedFeedItems(username, entityHash, options = {}) {
	entityHash = entityHash.trim().toLowerCase()
	if (!isEntityHash128(entityHash))
		return { entityHash, items: [] }

	const viewerContext = await loadViewerContext(username, options.viewerEntityHash || null)
	const itemContext = await createFeedItemBuildContext(username, null, options.viewerEntityHash || null)
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
		items.push(await buildPostFeedItem(username, targetEntityHash, post, itemContext))
	}

	items.sort((left, right) => compareFeedItems(left, right) * -1)
	return { entityHash, items }
}

/**
 * 列出指定帖子的可见回复。
 * @param {string} username 用户
 * @param {string} entityHash 作者
 * @param {string} postId 帖子
 * @param {{ viewerEntityHash?: string }} [options] 观看者
 * @returns {Promise<object[]>} 可见回复
 */
export async function listReplies(username, entityHash, postId, options = {}) {
	const viewerContext = await loadViewerContext(username, options.viewerEntityHash || null)
	const { canReplyUnderPolicy, featuredReplyKey, loadPostReplyGate, normalizeReplyDisplay } = await import('../lib/replyPolicy.mjs')
	const gate = await loadPostReplyGate(username, entityHash, postId)
	const replyPolicy = gate?.replyPolicy || 'everyone'
	const replyDisplay = gate?.replyDisplay || 'all'
	const authorView = await getTimelineMaterialized(username, entityHash)
	const featuredSet = new Set(authorView.featuredReplies?.[postId] || [])
	/** @type {object[]} */
	const replies = []
	const refs = await queryReplyIndex(username, entityHash, postId)

	for (const ref of refs) {
		const author = ref.entityHash
		if (isAuthorFilteredByPersonalSets(viewerContext.personalFilter, author)) continue
		if (isHiddenByAuthorReputation(author)) continue
		const view = await getTimelineMaterialized(username, author)
		const post = view.postById?.[ref.postId] || view.posts?.find(row => row.id === ref.postId)
		if (!post) continue
		if (!canViewPost({ ...post, entityHash: author }, viewerContext)) continue
		const allowed = await canReplyUnderPolicy({
			username,
			authorEntityHash: entityHash,
			replierEntityHash: author,
			replyPolicy,
			at: Number(post.hlc?.wall) || Number(post.timestamp) || Date.now(),
		})
		if (!allowed) continue
		const featured = featuredSet.has(featuredReplyKey(author, ref.postId))
		replies.push({ entityHash: author, post, featured })
	}

	if (!replies.length)
		for (const author of await listFollowedTimelineOwners(username, options.viewerEntityHash || null)) {
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
				const allowed = await canReplyUnderPolicy({
					username,
					authorEntityHash: entityHash,
					replierEntityHash: author,
					replyPolicy,
					at: Number(post.hlc?.wall) || Number(post.timestamp) || Date.now(),
				})
				if (!allowed) continue
				const featured = featuredSet.has(featuredReplyKey(author, post.id))
				replies.push({ entityHash: author, post, featured })
			}
		}

	replies.sort((left, right) => {
		if (left.featured !== right.featured) return left.featured ? -1 : 1
		const lw = Number(left.post.hlc.wall)
		const rw = Number(right.post.hlc.wall)
		return rw - lw
	})
	if (normalizeReplyDisplay(replyDisplay) === 'featured_only')
		return replies.filter(row => row.featured)
	return replies
}
