/**
 * 在已知时间线中搜索可见帖子（索引优先；支持结构化过滤与联邦 nearby）。
 */
import { buildPostFeedItem } from './feed/buildItem.mjs'
import { loadViewerContext } from './feed/home.mjs'
import { createFeedItemBuildContext, iterateVisiblePosts, iterateVisibleTimelineOwners } from './feed/iterate.mjs'
import { compareFeedItems } from './feedMerge.mjs'
import { canViewPost } from './feedVisibility.mjs'
import { postMatchesQuery } from './lib/postQuery.mjs'
import { hasSearchCriteria, parseSearchFilters, postMatchesFilters } from './lib/searchFilters.mjs'
import { querySocialPostIndex } from './searchIndex.mjs'
import { getTimelineMaterialized } from './timeline/materialize.mjs'

/**
 * @param {object} item feed 条目
 * @returns {string} 搜索分页游标
 */
export function searchItemCursorKey(item) {
	const wall = Number(item.hlc?.wall || item.post?.hlc?.wall || 0)
	return `${wall}:${item.postId}`
}

/**
 * @param {string} username 用户
 * @param {object} [options] 选项
 * @returns {Promise<{ query: string, items: object[], nextCursor: string | null, scope?: string, filters?: object }>} 搜索结果
 */
export async function searchPosts(username, options = {}) {
	const rawQuery = (options.q || '').trim()
	const filters = parseSearchFilters(options)
	if (filters.scope === 'nearby') {
		const { buildNearbyPostSearch } = await import('./search/network.mjs')
		return buildNearbyPostSearch(username, { ...options, ...filters, q: rawQuery || filters.q })
	}
	if (!hasSearchCriteria(filters))
		return { query: rawQuery, items: [], nextCursor: null, filters, scope: 'local' }

	const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100)
	const indexQuery = filters.q || (filters.tag ? `#${filters.tag}` : filters.author || filters.media || 'a')
	const viewerContext = await loadViewerContext(username, options.viewerEntityHash || null)
	const itemContext = await createFeedItemBuildContext(username, null, options.viewerEntityHash || null)
	const owners = []
	for await (const entityHash of iterateVisibleTimelineOwners(username, options.viewerEntityHash || null))
		owners.push(entityHash)

	const fetchLimit = options.cursor ? limit * 4 + 50 : limit * 2
	/** @type {Map<string, object>} */
	const itemsByKey = new Map()

	if (filters.q.length >= 2 || filters.tag) {
		const indexedHits = await querySocialPostIndex(username, owners, indexQuery, fetchLimit)
		for (const hit of indexedHits) {
			const view = await getTimelineMaterialized(username, hit.entityHash)
			const post = view.postById?.[hit.postId] || view.posts?.find(row => row.id === hit.postId)
			if (!post) continue
			const enriched = { ...post, entityHash: hit.entityHash }
			if (!canViewPost(enriched, viewerContext)) continue
			if (!postMatchesFilters(enriched, filters)) continue
			if (filters.q.length >= 2 && !postMatchesQuery(enriched, filters.q) && !(filters.tag && postMatchesQuery(enriched, `#${filters.tag}`)))
				continue
			itemsByKey.set(`${hit.entityHash}:${hit.postId}`, await buildPostFeedItem(username, hit.entityHash, post, itemContext))
		}
	}

	if (itemsByKey.size < fetchLimit)
		for await (const { entityHash, post } of iterateVisiblePosts(username, viewerContext)) {
			const key = `${entityHash}:${post.id}`
			if (itemsByKey.has(key)) continue
			const enriched = { ...post, entityHash }
			if (!postMatchesFilters(enriched, filters)) continue
			itemsByKey.set(key, await buildPostFeedItem(username, entityHash, post, itemContext))
			if (itemsByKey.size >= fetchLimit) break
		}

	let items = [...itemsByKey.values()]
	if (filters.sort === 'top')
		items.sort((left, right) => {
			const le = (left.engagement?.likes || 0) + 2 * (left.engagement?.reposts || 0) + (left.engagement?.replies || 0)
			const re = (right.engagement?.likes || 0) + 2 * (right.engagement?.reposts || 0) + (right.engagement?.replies || 0)
			if (le !== re) return re - le
			return compareFeedItems(left, right) * -1
		})
	else
		items.sort((left, right) => compareFeedItems(left, right) * -1)

	if (options.cursor) {
		const cursor = String(options.cursor)
		const index = items.findIndex(item => searchItemCursorKey(item) === cursor)
		items = index >= 0 ? items.slice(index + 1) : []
	}

	const page = items.slice(0, limit)
	const nextCursor = page.length === limit && items.length > limit
		? searchItemCursorKey(page[page.length - 1])
		: null
	return {
		query: rawQuery || (filters.tag ? `#${filters.tag}` : ''),
		items: page,
		nextCursor,
		filters,
		scope: 'local',
	}
}
