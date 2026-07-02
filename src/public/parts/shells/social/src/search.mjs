import { isEntityHashBlocked } from '../../../../../scripts/p2p/denylist.mjs'
import { isEntityHash128 } from '../../../../../scripts/p2p/entity_id.mjs'
import { pickNodeScore, shouldHideAuthorByReputation } from '../../../../../scripts/p2p/reputation.mjs'

import {
	buildPostFeedItem,
	createEngagementForPost,
} from './feed/buildItem.mjs'
import {
	buildEngagementIndex,
	buildViewerLikedSet,
	listKnownTimelineOwners,
	loadViewerContext,
} from './feedHelpers.mjs'
import { compareFeedItems } from './feedMerge.mjs'
import { canViewPost } from './feedVisibility.mjs'
import { createAuthorProfileLoader } from './lib/authorProfileSummary.mjs'
import { postMatchesQuery } from './lib/postQuery.mjs'
import { getTimelineMaterialized } from './timeline/materialize.mjs'

/**
 * 在已知时间线中搜索可见帖子（关注 + 自身）。
 * @param {string} username 用户
 * @param {object} [options] 选项
 * @param {string} options.q 查询（至少 2 字符）
 * @param {number} [options.limit=30] 结果上限
 * @returns {Promise<{ query: string, items: object[] }>} 搜索结果
 */
export async function searchPosts(username, options = {}) {
	const query = (options.q || '').trim()
	const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100)
	if (query.length < 2)
		return { query, items: [] }

	const viewerContext = await loadViewerContext(username)
	const engagement = await buildEngagementIndex(username)
	const viewerLiked = await buildViewerLikedSet(username)
	const authorProfile = createAuthorProfileLoader(username)
	const engagementForPost = createEngagementForPost(engagement, viewerLiked)
	const feedItemBuildContext = { authorProfile, engagementForPost }

	/** @type {object[]} */
	const items = []
	for (const entityHash of await listKnownTimelineOwners(username)) {
		if (!isEntityHash128(entityHash)) continue
		if (isEntityHashBlocked(entityHash)) continue
		if (shouldHideAuthorByReputation(entityHash, pickNodeScore)) continue
		const view = await getTimelineMaterialized(username, entityHash)
		if (!view.posts?.length) continue
		for (const post of view.posts) {
			if (!postMatchesQuery(post, query)) continue
			const enriched = { ...post, entityHash }
			if (!canViewPost(enriched, viewerContext))
				continue
			items.push(await buildPostFeedItem(username, entityHash, post, feedItemBuildContext))
		}
	}

	items.sort((left, right) => compareFeedItems(left, right) * -1)
	return { query, items: items.slice(0, limit) }
}
