/**
 * 话题订阅：tag_follow / tag_unfollow + 话题帖流。
 */
import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { buildPostFeedItem } from './feed/buildItem.mjs'
import { createFeedItemBuildContext, iterateVisiblePosts } from './feed/iterate.mjs'
import { compareFeedItems } from './feedMerge.mjs'
import { loadFollowingForActor } from './following.mjs'
import { extractHashtagsFromText } from './lib/hashtags.mjs'
import { postMatchesQuery } from './lib/postQuery.mjs'
import { querySocialPostIndex } from './searchIndex.mjs'
import { commitTimelineEvent } from './timeline/append.mjs'
import { getTimelineMaterialized } from './timeline/materialize.mjs'

/**
 * @param {string} tag 原始话题
 * @returns {string} 规范化 tag
 */
export function normalizeTopicTag(tag) {
	return String(tag || '').trim().replace(/^#/u, '').toLowerCase()
}

/**
 * @param {string} username replica
 * @param {string} entityHash 实体
 * @returns {Promise<{ tags: string[] }>} 已订阅
 */
export async function listFollowedTags(username, entityHash) {
	const view = await getTimelineMaterialized(username, entityHash)
	return { tags: [...view.followedTags || []].sort() }
}

/**
 * @param {string} username replica
 * @param {string} entityHash 实体
 * @param {string} tag 话题
 * @param {boolean} follow 是否订阅
 * @returns {Promise<{ tag: string, isFollowing: boolean, tags: string[] }>} 结果
 */
export async function setTagFollow(username, entityHash, tag, follow) {
	const cleaned = normalizeTopicTag(tag)
	if (cleaned.length < 2) throw new Error('tag too short')
	const { tags } = await listFollowedTags(username, entityHash)
	const already = tags.includes(cleaned)
	if (follow === already) return { tag: cleaned, isFollowing: follow, tags }
	await commitTimelineEvent(username, entityHash, {
		type: follow ? 'tag_follow' : 'tag_unfollow',
		content: { tag: cleaned },
	})
	const next = follow
		? [...tags, cleaned].sort()
		: tags.filter(row => row !== cleaned)
	return { tag: cleaned, isFollowing: follow, tags: next }
}

/**
 * @param {string} username replica
 * @param {string} tag 话题
 * @param {{ limit?: number, cursor?: string, viewerEntityHash?: string }} [options] 分页
 * @returns {Promise<{ tag: string, items: object[], nextCursor: string | null }>} 话题帖
 */
export async function buildTopicFeed(username, tag, options = {}) {
	const cleaned = normalizeTopicTag(tag)
	const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100)
	const query = `#${cleaned}`
	const viewer = options.viewerEntityHash || null
	const { following } = viewer
		? await loadFollowingForActor(username, viewer)
		: { following: [] }
	const owners = following.filter(isEntityHash128)
	const hits = await querySocialPostIndex(username, owners, query, limit * 4)
	/** @type {object[]} */
	const candidates = []
	const seen = new Set()
	const itemContext = await createFeedItemBuildContext(username, new Set(owners), viewer)

	for (const hit of hits) {
		const key = `${hit.entityHash}:${hit.postId}`
		if (seen.has(key)) continue
		seen.add(key)
		const view = await getTimelineMaterialized(username, hit.entityHash)
		const post = view.postById?.[hit.postId]
		if (!post || !postMatchesQuery({ ...post, entityHash: hit.entityHash }, query)) continue
		const item = await buildPostFeedItem(username, hit.entityHash, post, itemContext)
		if (!item) continue
		item.via = 'topic'
		candidates.push(item)
	}

	if (candidates.length < limit) {
		const { loadViewerContext } = await import('./feed/home.mjs')
		const viewerContext = await loadViewerContext(username, viewer)
		for await (const { entityHash, post } of iterateVisiblePosts(username, viewerContext)) {
			const key = `${entityHash}:${post.id}`
			if (seen.has(key)) continue
			const text = post.content?.text || ''
			const tags = [
				...extractHashtagsFromText(text),
				...Array.isArray(post.content?.tags) ? post.content.tags.map(t => String(t).toLowerCase()) : [],
			]
			if (!tags.includes(cleaned)) continue
			seen.add(key)
			const item = await buildPostFeedItem(username, entityHash, post, itemContext)
			if (!item) continue
			item.via = 'topic'
			candidates.push(item)
			if (candidates.length >= limit * 3) break
		}
	}

	candidates.sort((a, b) => -compareFeedItems(a, b))
	let start = 0
	if (options.cursor) {
		const idx = candidates.findIndex(item => `${item.hlc?.wall || 0}:${item.postId}` === options.cursor)
		start = idx >= 0 ? idx + 1 : 0
	}
	const page = candidates.slice(start, start + limit)
	const nextCursor = page.length === limit && start + limit < candidates.length
		? `${page[page.length - 1].hlc?.wall || 0}:${page[page.length - 1].postId}`
		: null
	return { tag: cleaned, items: page, nextCursor }
}
