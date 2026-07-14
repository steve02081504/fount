import { iterateVisiblePosts } from '../feed/iterate.mjs'
import { loadViewerContext } from '../feed.mjs'
import { extractHashtagsFromText } from '../lib/hashtags.mjs'
import { readTrendingHashtagCounts } from '../searchIndex.mjs'

/**
 * 从观看者可见帖子统计热门话题（索引计数优先，空则回退扫描）。
 * @param {string} username 用户
 * @param {object} [options] 选项
 * @param {number} [options.limit=12] 返回条数
 * @param {string} [options.viewerEntityHash] 观看实体；缺省为 operator
 * @returns {Promise<{ tags: { tag: string, count: number }[] }>} 热门话题
 */
export async function buildTrendingHashtags(username, options = {}) {
	const limit = Math.min(Math.max(Number(options.limit) || 12, 1), 32)
	const indexed = await readTrendingHashtagCounts(username, limit)
	if (indexed.tags.length) return indexed

	const viewerContext = await loadViewerContext(username, options.viewerEntityHash || null)
	/** @type {Map<string, number>} */
	const counts = new Map()

	for await (const { post } of iterateVisiblePosts(username, viewerContext)) {
		if (!post.content?.text) continue
		for (const tag of extractHashtagsFromText(post.content.text))
			counts.set(tag, (counts.get(tag) || 0) + 1)
	}

	const tags = [...counts.entries()]
		.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
		.slice(0, limit)
		.map(([tag, count]) => ({ tag, count }))

	return { tags }
}
