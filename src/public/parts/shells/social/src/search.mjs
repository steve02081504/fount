import { buildPostFeedItem } from './feed/buildItem.mjs'
import { loadViewerContext } from './feed/helpers.mjs'
import { createFeedItemBuildContext, iterateVisibleTimelineOwners } from './feed/iterate.mjs'
import { compareFeedItems } from './feedMerge.mjs'
import { postMatchesQuery } from './lib/postQuery.mjs'
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
 * 在已知时间线中搜索可见帖子（索引优先，未覆盖 owner 回退扫描）。
 * @param {string} username 用户
 * @param {object} [options] 选项
 * @param {string} options.q 查询（至少 2 字符）
 * @param {number} [options.limit=30] 结果上限
 * @param {string} [options.cursor] 分页游标
 * @returns {Promise<{ query: string, items: object[], nextCursor: string | null }>} 搜索结果
 */
export async function searchPosts(username, options = {}) {
	const query = (options.q || '').trim()
	const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100)
	if (query.length < 2)
		return { query, items: [], nextCursor: null }

	const viewerContext = await loadViewerContext(username, options.actingEntityHash || null)
	const itemContext = await createFeedItemBuildContext(username, null, options.actingEntityHash || null)
	const owners = []
	for await (const entityHash of iterateVisibleTimelineOwners(username))
		owners.push(entityHash)

	const fetchLimit = options.cursor ? limit * 4 + 50 : limit * 2
	const indexedHits = await querySocialPostIndex(username, owners, query, fetchLimit)
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

	if (itemsByKey.size < fetchLimit) {
		const { iterateVisiblePosts } = await import('./feed/iterate.mjs')
		for await (const { entityHash, post } of iterateVisiblePosts(username, viewerContext)) {
			const key = `${entityHash}:${post.id}`
			if (itemsByKey.has(key)) continue
			if (!postMatchesQuery(post, query)) continue
			itemsByKey.set(key, await buildPostFeedItem(username, entityHash, post, itemContext))
			if (itemsByKey.size >= fetchLimit) break
		}
	}

	let items = [...itemsByKey.values()]
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
	return { query, items: page, nextCursor }
}
