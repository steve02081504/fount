/** Social 探索页帖子推荐（账户推荐见 endpoints/feed.mjs `getExploreAccounts`）。 */
import { socialRequest } from './client.mjs'

/**
 * @param {{ limit?: number, mediaOnly?: boolean }} [options] 数量与媒体过滤
 * @returns {Promise<{ posts: object[] }>} 探索帖子
 */
export function getExplorePosts({ limit = 20, mediaOnly = false } = {}) {
	const mediaQuery = mediaOnly ? '&mediaOnly=true' : ''
	return socialRequest(`/explore/posts?limit=${limit}${mediaQuery}`)
}
