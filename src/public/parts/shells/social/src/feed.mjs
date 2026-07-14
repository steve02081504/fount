import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isEntityHashBlocked } from 'npm:@steve02081504/fount-p2p/node/denylist'
import {
	isAuthorFilteredByPersonalSets,
} from 'npm:@steve02081504/fount-p2p/node/personal_block'
import { pickNodeScore } from 'npm:@steve02081504/fount-p2p/node/reputation_store'

import { reputationSortPenalty, shouldHideAuthorByReputation } from './federation/reputation_social.mjs'
import {
	buildPostFeedItem,
	buildRepostFeedItem,
	withDecryptedPostContent,
} from './feed/buildItem.mjs'
import {
	listFollowedTimelineOwners,
	loadViewerContext,
} from './feed/helpers.mjs'
import { createFeedItemBuildContext } from './feed/iterate.mjs'
import { compareFeedItems, kWayMergeFeedStreams, pickNextFeedStreamIndex } from './feedMerge.mjs'
import { canViewPost } from './feedVisibility.mjs'
import { loadFollowing, loadFollowingForActor } from './following.mjs'
import { queryReplyIndex } from './searchIndex.mjs'
import { getTimelineMaterialized } from './timeline/materialize.mjs'

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
 * @param {{ limit?: number, cursor?: string }} [options] 分页
 * @returns {Promise<{ entityHash: string, items: object[], nextCursor: string | null }>} 与首页 feed 同构的帖子列表
 */
export async function buildProfileFeedItems(username, entityHash, options = {}) {
	const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100)
	entityHash = entityHash.trim().toLowerCase()
	if (!isEntityHash128(entityHash))
		return { entityHash, items: [], nextCursor: null }

	const viewerContext = await loadViewerContext(username)
	const itemContext = await createFeedItemBuildContext(username)
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
 * @returns {Promise<{ entityHash: string, items: object[] }>} 点赞过的帖子列表
 */
export async function buildLikedFeedItems(username, entityHash) {
	entityHash = entityHash.trim().toLowerCase()
	if (!isEntityHash128(entityHash))
		return { entityHash, items: [] }

	const viewerContext = await loadViewerContext(username)
	const itemContext = await createFeedItemBuildContext(username)
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
 * @returns {Promise<object[]>} 可见回复
 */
export async function listReplies(username, entityHash, postId) {
	const viewerContext = await loadViewerContext(username)
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
		replies.push({ entityHash: author, post })
	}

	if (!replies.length) 
		for (const author of await listFollowedTimelineOwners(username)) {
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
