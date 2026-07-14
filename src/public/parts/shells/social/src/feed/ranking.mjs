import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isEntityHashBlocked } from 'npm:@steve02081504/fount-p2p/node/denylist'
import { pickNodeScore } from 'npm:@steve02081504/fount-p2p/node/reputation_store'

import { socialPostKey } from '../federation/post_key.mjs'
import { shouldHideAuthorByReputation } from '../federation/reputation_social.mjs'
import { loadViewerContext } from '../feed.mjs'
import { canViewPost } from '../feedVisibility.mjs'
import { loadFollowingForActor } from '../following.mjs'
import { getTimelineMaterialized } from '../timeline/materialize.mjs'

import { buildPostFeedItem } from './buildItem.mjs'
import { createFeedItemBuildContext } from './iterate.mjs'

const SCORE_HALF_LIFE_MS = 86_400_000

/**
 * @param {object} post 物化帖
 * @param {object} engagement 互动索引
 * @param {number} affinity 与作者互动次数
 * @param {number} [now=Date.now()] 当前时刻
 * @returns {number} 推荐分
 */
export function scorePostForYou(post, engagement, affinity, now = Date.now()) {
	const ageMs = Math.max(0, now - Number(post.hlc?.wall || post.timestamp || now))
	const freshness = Math.exp(-ageMs / SCORE_HALF_LIFE_MS)
	const key = socialPostKey(post.entityHash || '', post.id)
	const likes = engagement.likes.get(key) || 0
	const reposts = engagement.reposts.get(key) || 0
	const replies = engagement.replies.get(key) || 0
	const engagementBoost = 1 + Math.log1p(likes + 2 * reposts + replies)
	const affinityBoost = 1 + Math.log1p(affinity)
	return freshness * engagementBoost * affinityBoost
}

/**
 * @param {string} username replica
 * @param {Set<string>} following 关注列表
 * @returns {Promise<Map<string, number>>} 作者 → 双向互动次数
 */
async function buildAffinityIndex(username, following) {
	/** @type {Map<string, number>} */
	const affinity = new Map()
	for (const entityHash of following) {
		if (!isEntityHash128(entityHash)) continue
		const view = await getTimelineMaterialized(username, entityHash)
		for (const like of view.likes || [])
			if (like.content?.targetEntityHash)
				affinity.set(String(like.content.targetEntityHash).toLowerCase(), (affinity.get(String(like.content.targetEntityHash).toLowerCase()) || 0) + 1)
		for (const repost of view.reposts || [])
			if (repost.content?.targetEntityHash)
				affinity.set(String(repost.content.targetEntityHash).toLowerCase(), (affinity.get(String(repost.content.targetEntityHash).toLowerCase()) || 0) + 2)
		for (const post of view.posts || []) {
			const replyTo = post.content?.replyTo
			if (replyTo?.entityHash)
				affinity.set(String(replyTo.entityHash).toLowerCase(), (affinity.get(String(replyTo.entityHash).toLowerCase()) || 0) + 1)
		}
	}
	return affinity
}

/**
 * @param {string} username replica
 * @param {Set<string>} following 关注列表
 * @param {object} viewerContext 观看者上下文
 * @returns {AsyncGenerator<{ entityHash: string, post: object, score: number }>} 候选帖
 */
async function* iterateForYouCandidates(username, following, viewerContext) {
	const { buildEngagementIndex } = await import('../feed.mjs')
	const engagement = await buildEngagementIndex(username, following)
	const affinity = await buildAffinityIndex(username, following)
	const seen = new Set()

	for (const entityHash of following) {
		if (!isEntityHash128(entityHash) || isEntityHashBlocked(entityHash)) continue
		if (shouldHideAuthorByReputation(entityHash, pickNodeScore)) continue
		const view = await getTimelineMaterialized(username, entityHash)
		for (const post of view.posts || []) {
			const enriched = { ...post, entityHash }
			if (!canViewPost(enriched, viewerContext)) continue
			const key = `${entityHash}:${post.id}`
			if (seen.has(key)) continue
			seen.add(key)
			yield {
				entityHash,
				post,
				score: scorePostForYou({ ...post, entityHash }, engagement, affinity.get(entityHash.toLowerCase()) || 0),
			}
		}
	}

	for (const entityHash of following) {
		if (!isEntityHash128(entityHash)) continue
		const view = await getTimelineMaterialized(username, entityHash)
		for (const like of view.likes || []) {
			const targetEntity = String(like.content?.targetEntityHash || '').toLowerCase()
			const targetPostId = String(like.content?.targetPostId || '')
			if (!isEntityHash128(targetEntity) || !targetPostId) continue
			const key = `${targetEntity}:${targetPostId}`
			if (seen.has(key)) continue
			const targetView = await getTimelineMaterialized(username, targetEntity)
			const post = targetView.postById?.[targetPostId]
			if (!post) continue
			const enriched = { ...post, entityHash: targetEntity }
			if (!canViewPost(enriched, viewerContext)) continue
			if ((post.content?.visibility || 'public') !== 'public') continue
			seen.add(key)
			yield {
				entityHash: targetEntity,
				post,
				score: scorePostForYou(enriched, engagement, affinity.get(targetEntity) || 0) * 0.85,
			}
		}
		for (const repost of view.reposts || []) {
			const targetEntity = String(repost.content?.targetEntityHash || '').toLowerCase()
			const targetPostId = String(repost.content?.targetPostId || '')
			if (!isEntityHash128(targetEntity) || !targetPostId) continue
			const key = `${targetEntity}:${targetPostId}`
			if (seen.has(key)) continue
			const targetView = await getTimelineMaterialized(username, targetEntity)
			const post = targetView.postById?.[targetPostId]
			if (!post) continue
			const enriched = { ...post, entityHash: targetEntity }
			if (!canViewPost(enriched, viewerContext)) continue
			if ((post.content?.visibility || 'public') !== 'public') continue
			seen.add(key)
			yield {
				entityHash: targetEntity,
				post,
				score: scorePostForYou(enriched, engagement, affinity.get(targetEntity) || 0) * 0.9,
			}
		}
	}
}

/**
 * @param {object} item feed 条目
 * @returns {string} for_you 游标
 */
export function forYouCursorKey(item) {
	return `${Number(item.score || 0).toFixed(12)}:${item.postId}`
}

/**
 * @param {string} username 用户
 * @param {object} [options] 分页选项
 * @returns {Promise<{ items: object[], nextCursor: string | null }>} For You feed 分页
 */
export async function buildForYouFeed(username, options = {}) {
	const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200)
	const viewer = options.viewerEntityHash || null
	const { following } = await loadFollowingForActor(username, viewer)
	const viewerContext = await loadViewerContext(username, viewer)
	const itemContext = await createFeedItemBuildContext(username, following, viewer)

	/** @type {{ entityHash: string, post: object, score: number }[]} */
	const candidates = []
	for await (const row of iterateForYouCandidates(username, following, viewerContext))
		candidates.push(row)

	candidates.sort((left, right) => right.score - left.score || right.post.id.localeCompare(left.post.id))

	let start = 0
	if (options.cursor) {
		const cursor = String(options.cursor)
		const index = candidates.findIndex(row => forYouCursorKey({ score: row.score, postId: row.post.id }) === cursor)
		start = index >= 0 ? index + 1 : 0
	}

	const slice = candidates.slice(start, start + limit + 1)
	const hasMore = slice.length > limit
	const page = hasMore ? slice.slice(0, limit) : slice
	const items = []
	for (const row of page) {
		const item = await buildPostFeedItem(username, row.entityHash, row.post, itemContext)
		item.score = row.score
		items.push(item)
	}
	const nextCursor = hasMore && items.length
		? forYouCursorKey(items[items.length - 1])
		: null
	return { items, nextCursor }
}
