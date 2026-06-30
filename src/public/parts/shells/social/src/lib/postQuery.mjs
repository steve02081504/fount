/**
 * 帖子正文匹配（搜索 / 过滤用纯函数）。
 */
import { extractHashtagsFromText } from './hashtags.mjs'

/**
 * 规范化用户搜索查询（文本或 #话题）。
 * @param {string} query 原始查询
 * @returns {{ kind: 'none' | 'text' | 'hashtag', value: string, display: string }} 规范化查询
 */
export function normalizeSearchQuery(query) {
	const raw = (query || '').trim()
	if (!raw) return { kind: 'none', value: '', display: '' }
	if (raw.startsWith('#')) {
		const tag = raw.slice(1).trim().toLowerCase()
		if (tag.length >= 2)
			return { kind: 'hashtag', value: tag, display: `#${tag}` }
		return { kind: 'none', value: '', display: raw }
	}
	return { kind: 'text', value: raw.toLowerCase(), display: raw }
}


/**
 * 判断物化帖子是否匹配搜索查询。
 * @param {object} post 物化帖子
 * @param {string} query 用户查询
 * @returns {boolean} 是否匹配
 */
export function postMatchesQuery(post, query) {
	const norm = normalizeSearchQuery(query)
	if (norm.kind === 'none' || norm.value.length < 2) return false
	if (post?.content?.protected) return false
	const text = (post.content?.text || '').toLowerCase()
	if (norm.kind === 'hashtag')
		return extractHashtagsFromText(text).includes(norm.value)
	if (text.includes(norm.value)) return true
	const author = (post.entityHash || '').toLowerCase()
	if (norm.value.length >= 8 && author.includes(norm.value)) return true
	return false
}
