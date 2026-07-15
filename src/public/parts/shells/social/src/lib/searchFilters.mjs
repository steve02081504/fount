/**
 * 帖文搜索结构化过滤解析。
 */
import { extractHashtagsFromText } from './hashtags.mjs'
import { normalizeSearchQuery, postMatchesQuery } from './postQuery.mjs'

/**
 * @param {object} options 原始选项
 * @returns {{ q: string, author: string | null, media: 'image' | 'video' | null, tag: string | null, before: number | null, after: number | null, sort: 'latest' | 'top', scope: 'local' | 'nearby' }} 规范化
 */
export function parseSearchFilters(options = {}) {
	let q = String(options.q || '').trim()
	let author = options.author ? String(options.author).trim().toLowerCase() : null
	let media = null
	const mediaRaw = String(options.media || '').trim().toLowerCase()
	if (mediaRaw === 'image' || mediaRaw === 'video') media = mediaRaw
	let tag = options.tag ? String(options.tag).trim().replace(/^#/u, '').toLowerCase() : null
	const before = options.before != null && Number.isFinite(Number(options.before)) ? Number(options.before) : null
	const after = options.after != null && Number.isFinite(Number(options.after)) ? Number(options.after) : null
	const sort = String(options.sort || 'latest').trim() === 'top' ? 'top' : 'latest'
	const scope = String(options.scope || 'local').trim() === 'nearby' ? 'nearby' : 'local'

	const tokens = q.split(/\s+/u).filter(Boolean)
	const leftover = []
	for (const token of tokens) {
		const lower = token.toLowerCase()
		if (lower.startsWith('author:') && !author) {
			author = token.slice(7).trim().toLowerCase() || null
			continue
		}
		if (lower.startsWith('media:') && !media) {
			const value = token.slice(6).trim().toLowerCase()
			if (value === 'image' || value === 'video') media = value
			continue
		}
		if (lower.startsWith('tag:') && !tag) {
			tag = token.slice(4).trim().replace(/^#/u, '').toLowerCase() || null
			continue
		}
		leftover.push(token)
	}
	q = leftover.join(' ').trim()
	if (!tag && q.startsWith('#')) {
		const norm = normalizeSearchQuery(q)
		if (norm.kind === 'hashtag') {
			tag = norm.value
			q = ''
		}
	}
	return { q, author, media, tag, before, after, sort, scope }
}

/**
 * @param {object} post 帖
 * @param {ReturnType<typeof parseSearchFilters>} filters 过滤
 * @returns {boolean} 是否命中
 */
export function postMatchesFilters(post, filters) {
	if (filters.author) {
		const author = String(post.entityHash || '').toLowerCase()
		if (!author.includes(filters.author)) return false
	}
	if (filters.tag) {
		const text = String(post.content?.text || '')
		const tags = [
			...extractHashtagsFromText(text),
			...Array.isArray(post.content?.tags) ? post.content.tags.map(t => String(t).toLowerCase()) : [],
		]
		if (!tags.includes(filters.tag)) return false
	}
	if (filters.media) {
		const refs = Array.isArray(post.content?.mediaRefs) ? post.content.mediaRefs : []
		if (!refs.some(ref => String(ref?.kind || '').toLowerCase() === filters.media)) return false
	}
	const wall = Number(post.hlc?.wall) || Number(post.timestamp) || 0
	if (filters.before != null && wall >= filters.before) return false
	if (filters.after != null && wall <= filters.after) return false
	if (filters.q && filters.q.length >= 2 && !postMatchesQuery(post, filters.q)) return false
	if (!filters.q && !filters.tag && !filters.author && !filters.media && filters.before == null && filters.after == null)
		return false
	return true
}

/**
 * 是否有足够搜索条件。
 * @param {ReturnType<typeof parseSearchFilters>} filters 过滤
 * @returns {boolean} 可否搜索
 */
export function hasSearchCriteria(filters) {
	if (filters.q && filters.q.length >= 2) return true
	if (filters.tag && filters.tag.length >= 2) return true
	if (filters.author && filters.author.length >= 2) return true
	if (filters.media) return true
	return false
}
