/** Social 首页 feed / 短视频流 / 附近推荐 / 热门话题。 */
import { socialRequest } from './client.mjs'

/**
 * @param {{ limit?: number, cursor?: string, ranking?: 'latest' | 'for_you' }} [options] 分页与排序
 * @returns {Promise<{ items: object[], nextCursor: string | null }>} feed 页
 */
export function getFeed({ limit = 30, cursor, ranking } = {}) {
	const rankingQuery = ranking === 'for_you' ? '&ranking=for_you' : ''
	const cursorQuery = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
	return socialRequest(`/feed?limit=${limit}${rankingQuery}${cursorQuery}`)
}

/**
 * 触发一次 feed 与关注方同步。
 * @returns {Promise<void>}
 */
export function syncFeed() {
	return socialRequest('/feed/sync', { method: 'POST' })
}

/**
 * @param {number} [limit=5] 数量
 * @returns {Promise<{ accounts: object[] }>} 推荐关注账户
 */
export function getExploreAccounts(limit = 5) {
	return socialRequest(`/explore?limit=${limit}`)
}

/**
 * @param {{ scope?: 'nearby' | 'local', limit?: number }} [options] 范围与数量
 * @returns {Promise<{ tags: { tag: string, count: number }[] }>} 热门话题
 */
export function getTrendingHashtags({ scope = 'nearby', limit = 12 } = {}) {
	return socialRequest(`/hashtags/trending?limit=${limit}&scope=${scope}`)
}

/**
 * @param {{ limit?: number, cursor?: string }} [options] 分页
 * @returns {Promise<{ items: object[], nextCursor: string | null }>} 短视频 feed 页
 */
export function getVideosFeed({ limit = 20, cursor } = {}) {
	const cursorQuery = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
	return socialRequest(`/videos/feed?limit=${limit}${cursorQuery}`)
}
