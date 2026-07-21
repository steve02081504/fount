import { extractHashtagsFromText } from './hashtags.mjs'

const MAX_ENTRIES = 200
const MAX_PATTERN_LEN = 64

/**
 * @param {unknown} raw 原始条目
 * @returns {object | null} 规范化条目
 */
export function normalizeMutedKeywordEntry(raw) {
	if (!raw || typeof raw !== 'object') return null
	const pattern = String(/** @type {{ pattern?: unknown }} */raw.pattern || '').trim().toLowerCase()
	if (!pattern || pattern.length > MAX_PATTERN_LEN) return null
	const matchTags = /** @type {{ matchTags?: unknown }} */raw.matchTags !== false
	const expiresRaw = /** @type {{ expiresAt?: unknown }} */raw.expiresAt
	const expiresAt = expiresRaw == null || expiresRaw === ''
		? undefined
		: Number(expiresRaw)
	if (expiresAt != null && (!Number.isFinite(expiresAt) || expiresAt <= 0)) return null
	return {
		pattern,
		matchTags,
		...expiresAt != null ? { expiresAt } : {},
	}
}

/**
 * @param {object[]} entries 条目列表
 * @returns {object[]} 去重且惰性清理过期后的列表
 */
export function pruneMutedKeywordEntries(entries) {
	const now = Date.now()
	const seen = new Set()
	const out = []
	for (const raw of entries || []) {
		const entry = normalizeMutedKeywordEntry(raw)
		if (!entry) continue
		if (entry.expiresAt != null && entry.expiresAt <= now) continue
		if (seen.has(entry.pattern)) continue
		seen.add(entry.pattern)
		out.push(entry)
		if (out.length >= MAX_ENTRIES) break
	}
	return out
}

/**
 * 帖子是否命中观看者的关键词/标签屏蔽表。
 * @param {object} post 帖子（含 content.text / tags / contentWarning）
 * @param {{ entries?: object[] } | null | undefined} mutedKeywords loadMutedKeywords 结果
 * @returns {boolean} 命中则应隐藏
 */
export function postMatchesMutedKeywords(post, mutedKeywords) {
	const entries = mutedKeywords?.entries
	if (!entries?.length) return false
	const text = String(post?.content?.text || '').toLowerCase()
	const warning = String(post?.content?.contentWarning || '').toLowerCase()
	const haystack = `${text}\n${warning}`
	const tagSet = new Set([
		...extractHashtagsFromText(post?.content?.text || ''),
		...(Array.isArray(post?.content?.tags) ? post.content.tags : []).map(tag => String(tag).trim().toLowerCase()).filter(Boolean),
	])
	const now = Date.now()
	for (const entry of entries) {
		const expiresAt = entry.expiresAt
		if (expiresAt != null && Number(expiresAt) > 0 && Number(expiresAt) <= now) continue
		const pattern = String(entry.pattern || '').trim().toLowerCase()
		if (!pattern) continue
		if (haystack.includes(pattern)) return true
		if (entry.matchTags !== false) {
			const bare = pattern.startsWith('#') ? pattern.slice(1) : pattern
			if (bare && tagSet.has(bare)) return true
		}
	}
	return false
}
