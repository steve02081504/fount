/** Social 话题（hashtag）页与关注。 */
import { socialRequest } from './client.mjs'

/**
 * @param {string} tag 标签（不含 `#`）
 * @param {{ limit?: number, cursor?: string }} [options] 分页
 * @returns {Promise<{ items: object[], nextCursor: string | null }>} 话题帖子页
 */
export function getTopicPosts(tag, { limit = 30, cursor } = {}) {
	const params = new URLSearchParams({ limit: String(limit) })
	if (cursor) params.set('cursor', cursor)
	return socialRequest(`/topics/${encodeURIComponent(tag)}/posts?${params}`)
}

/**
 * @param {string} tag 标签
 * @param {boolean} follow 关注 / 取消关注
 * @returns {Promise<object>} 写入结果
 */
export function followTopic(tag, follow) {
	return socialRequest('/topics/follow', { method: 'POST', body: JSON.stringify({ tag, follow }) })
}

/**
 * @returns {Promise<{ tags: string[] }>} 已关注话题
 */
export function getFollowedTopics() {
	return socialRequest('/topics/followed')
}
