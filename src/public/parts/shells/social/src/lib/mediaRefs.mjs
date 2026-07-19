import { isSafeHtmlUrl } from 'fount/public/pages/scripts/lib/sanitizeHtml.mjs'
import { resolveSensitiveMedia as resolveSensitiveMediaShared } from 'fount/public/parts/shells/chat/public/shared/messageFields.mjs'

const ALT_MAX = 1500
const MEDIA_MAX = 16

/**
 * 与 chat `messageFields.resolveSensitiveMedia` 同实现；Social 入口再导出以免调用方改路径。
 */
export const resolveSensitiveMedia = resolveSensitiveMediaShared

/**
 * 去掉本地 File / objectUrl / pending（草稿持久化用；不校验 url）。
 * @param {unknown} refs 原始 mediaRefs
 * @returns {object[]} 可序列化 refs
 */
export function stripTransientMediaFields(refs) {
	if (!Array.isArray(refs)) return []
	return refs.map(ref => {
		if (!ref || typeof ref !== 'object') return null
		const { file: _f, objectUrl: _o, pending: _p, ...rest } = /** @type {object} */ ref
		return rest
	}).filter(Boolean)
}

/**
 * 清理入站 / 本机写入的 mediaRefs（截断 alt、限制数量、剥危险 url scheme）。
 * @param {unknown} raw 原始 refs
 * @returns {object[]} 清洗后的 refs
 */
export function sanitizeMediaRefs(raw) {
	if (!Array.isArray(raw)) return []
	const out = []
	for (const ref of stripTransientMediaFields(raw).slice(0, MEDIA_MAX)) {
		if (!ref || typeof ref !== 'object') continue
		const cleaned = { ...ref }
		if (cleaned.alt != null) {
			const alt = String(cleaned.alt).trim().slice(0, ALT_MAX)
			if (alt) cleaned.alt = alt
			else delete cleaned.alt
		}
		if (cleaned.url != null) 
			if (isSafeHtmlUrl(cleaned.url)) cleaned.url = String(cleaned.url).trim()
			else delete cleaned.url
		
		if (!cleaned.url && !(cleaned.entityHash && cleaned.path)) continue
		out.push(cleaned)
	}
	return out
}
