export const DWELL_MIN_MS = 3000
export const DWELL_MAX_MS = 120_000
export const AUTHOR_BOOST_PER_DWELL = 0.25
export const TAG_WEIGHT_PER_DWELL = 0.15

/**
 * @param {unknown} raw 原始条目
 * @returns {{ author: string, postId: string, tags: string[], dwellMs: number, at: number } | null} 规范化
 */
export function normalizeDwellEntry(raw) {
	if (!raw || typeof raw !== 'object') return null
	const author = String(/** @type {{ author?: unknown }} */(raw).author || '').trim().toLowerCase()
	const postId = String(/** @type {{ postId?: unknown }} */(raw).postId || '').trim().toLowerCase()
	if (!author || !postId) return null
	const dwellMsRaw = Number(/** @type {{ dwellMs?: unknown }} */(raw).dwellMs) || 0
	const watchMs = Number(/** @type {{ watchMs?: unknown }} */(raw).watchMs) || 0
	const dwellMs = Math.min(DWELL_MAX_MS, Math.max(0, Math.max(dwellMsRaw, watchMs)))
	if (dwellMs < DWELL_MIN_MS) return null
	const tags = Array.isArray(/** @type {{ tags?: unknown }} */(raw).tags)
		? [...new Set(/** @type {unknown[]} */(/** @type {{ tags?: unknown }} */(raw).tags)
			.map(tag => String(tag).trim().toLowerCase())
			.filter(Boolean))].slice(0, 16)
		: []
	const watchRatio = Math.min(1, Math.max(0, Number(/** @type {{ watchRatio?: unknown }} */(raw).watchRatio) || 0))
	return {
		author,
		postId,
		tags,
		dwellMs,
		...watchMs ? { watchMs } : {},
		...watchRatio ? { watchRatio } : {},
		at: Number(/** @type {{ at?: unknown }} */(raw).at) || Date.now(),
	}
}
