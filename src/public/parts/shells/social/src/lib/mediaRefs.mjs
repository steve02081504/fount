import { resolveSensitiveMedia as resolveSensitiveMediaShared } from 'fount/public/parts/shells/chat/public/shared/messageFields.mjs'

const ALT_MAX = 1500
const MEDIA_MAX = 16

/**
 * 与 chat `messageFields.resolveSensitiveMedia` 同实现；Social 入口再导出以免调用方改路径。
 */
export const resolveSensitiveMedia = resolveSensitiveMediaShared

/**
 * 清理入站 / 本机写入的 mediaRefs（截断 alt、限制数量）。
 * @param {unknown} raw 原始 refs
 * @returns {object[]} 清洗后的 refs
 */
export function sanitizeMediaRefs(raw) {
	if (!Array.isArray(raw)) return []
	const out = []
	for (const ref of raw.slice(0, MEDIA_MAX)) {
		if (!ref || typeof ref !== 'object') continue
		const cleaned = { ...ref }
		if (cleaned.alt != null) {
			const alt = String(cleaned.alt).trim().slice(0, ALT_MAX)
			if (alt) cleaned.alt = alt
			else delete cleaned.alt
		}
		out.push(cleaned)
	}
	return out
}
