import { buildPostFeedItem } from './feed/buildItem.mjs'
import { loadViewerContext } from './feed/helpers.mjs'
import { createFeedItemBuildContext, iterateVisibleTimelineOwners } from './feed/iterate.mjs'
import { compareFeedItems } from './feedMerge.mjs'
import { postMatchesQuery } from './lib/postQuery.mjs'
import { querySocialPostIndex } from './searchIndex.mjs'
import { getTimelineMaterialized } from './timeline/materialize.mjs'

/**
 * 在已知时间线中搜索可见帖子（索引优先，未覆盖 owner 回退扫描）。
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
	const itemContext = await createFeedItemBuildContext(username)
	const owners = []
	for await (const entityHash of iterateVisibleTimelineOwners(username))
		owners.push(entityHash)

	const indexedHits = await querySocialPostIndex(username, owners, query, limit)
	/** @type {Map<string, object>} */
	const itemsByKey = new Map()

	for (const hit of indexedHits) {
		const view = await getTimelineMaterialized(username, hit.entityHash)
		const post = view.postById?.[hit.postId] || view.posts?.find(row => row.id === hit.postId)
		if (!post) continue
		const enriched = { ...post, entityHash: hit.entityHash }
		const { canViewPost } = await import('./feedVisibility.mjs')
		if (!canViewPost(enriched, viewerContext)) continue
		const item = await buildPostFeedItem(username, hit.entityHash, post, itemContext)
		itemsByKey.set(`${hit.entityHash}:${hit.postId}`, item)
	}

	if (itemsByKey.size < limit) {
		const { iterateVisiblePosts } = await import('./feed/iterate.mjs')
		for await (const { entityHash, post } of iterateVisiblePosts(username, viewerContext)) {
			const key = `${entityHash}:${post.id}`
			if (itemsByKey.has(key)) continue
			if (!postMatchesQuery(post, query)) continue
			itemsByKey.set(key, await buildPostFeedItem(username, entityHash, post, itemContext))
			if (itemsByKey.size >= limit) break
		}
	}

	const items = [...itemsByKey.values()]
	items.sort((left, right) => compareFeedItems(left, right) * -1)
	return { query, items: items.slice(0, limit) }
}
