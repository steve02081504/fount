import { buildPostFeedItem } from './feed/buildItem.mjs'
import { loadViewerContext } from './feed/helpers.mjs'
import { createFeedItemBuildContext, iterateVisiblePosts } from './feed/iterate.mjs'
import { compareFeedItems } from './feedMerge.mjs'
import { postMatchesQuery } from './lib/postQuery.mjs'

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
	const itemContext = await createFeedItemBuildContext(username)

	/** @type {object[]} */
	const items = []
	for await (const { entityHash, post } of iterateVisiblePosts(username, viewerContext)) {
		if (!postMatchesQuery(post, query)) continue
		items.push(await buildPostFeedItem(username, entityHash, post, itemContext))
	}

	items.sort((left, right) => compareFeedItems(left, right) * -1)
	return { query, items: items.slice(0, limit) }
}
