/**
 * 频道消息扩展字段清洗（locale / content_warning / sensitive_media / forwardedFrom）。
 * 入站联邦与本机写入共用。
 */

/**
 *
 */
export const CONTENT_WARNING_MAX = 200
/**
 *
 */
export const LOCALE_MAX = 32
/**
 *
 */
export const ALT_MAX = 1500

/**
 * @param {unknown} value 原始开关
 * @param {string} [contentWarning] 内容警告
 * @returns {boolean} 是否视为敏感媒体
 */
export function resolveSensitiveMedia(value, contentWarning) {
	if (value === true) return true
	if (value === false) return false
	return Boolean(String(contentWarning || '').trim())
}

/**
 * @param {unknown} raw 原始 locale
 * @returns {string | undefined} 清洗后
 */
export function sanitizeLocale(raw) {
	const locale = String(raw || '').trim().slice(0, LOCALE_MAX)
	return locale || undefined
}

/**
 * @param {unknown} raw 原始 CW
 * @returns {string | undefined} 清洗后
 */
export function sanitizeContentWarning(raw) {
	const warning = String(raw || '').trim().slice(0, CONTENT_WARNING_MAX)
	return warning || undefined
}

/**
 * @param {unknown} raw 原始 alt
 * @returns {string | undefined} 清洗后
 */
export function sanitizeAlt(raw) {
	const alt = String(raw || '').trim().slice(0, ALT_MAX)
	return alt || undefined
}

/**
 * @param {unknown} raw 转发元数据
 * @returns {object | undefined} 清洗后
 */
export function sanitizeForwardedFrom(raw) {
	if (!raw || typeof raw !== 'object') return undefined
	const src = /** @type {Record<string, unknown>} */ raw
	const groupId = String(src.groupId || '').trim()
	const channelId = String(src.channelId || '').trim()
	const eventId = String(src.eventId || '').trim().toLowerCase()
	if (!groupId || !channelId || !eventId) return undefined
	const out = {
		groupId,
		channelId,
		eventId,
		...src.senderName != null ? { senderName: String(src.senderName).trim().slice(0, 100) } : {},
		...src.shareUrl != null ? { shareUrl: String(src.shareUrl).trim().slice(0, 2048) } : {},
	}
	return out
}

/**
 * 将扩展展示字段写入 content（就地规范后返回新对象）。
 * @param {Record<string, unknown>} content 消息 content
 * @returns {Record<string, unknown>} 清洗后
 */
export function sanitizeMessageExtras(content) {
	if (!content || typeof content !== 'object') return content
	const out = { ...content }

	const locale = sanitizeLocale(out.locale)
	if (locale) out.locale = locale
	else delete out.locale

	const content_warning = sanitizeContentWarning(out.content_warning)
	if (content_warning) out.content_warning = content_warning
	else delete out.content_warning

	if (resolveSensitiveMedia(out.sensitive_media, content_warning))
		out.sensitive_media = true
	else
		delete out.sensitive_media

	const forwardedFrom = sanitizeForwardedFrom(out.forwardedFrom)
	if (forwardedFrom) out.forwardedFrom = forwardedFrom
	else delete out.forwardedFrom

	delete out.embeds

	if (out.fileAlts && typeof out.fileAlts === 'object' && !Array.isArray(out.fileAlts)) {
		/** @type {Record<string, string>} */
		const alts = {}
		for (const [fileId, alt] of Object.entries(/** @type {Record<string, unknown>} */ out.fileAlts)) {
			const cleaned = sanitizeAlt(alt)
			if (cleaned && fileId) alts[String(fileId)] = cleaned
		}
		if (Object.keys(alts).length) out.fileAlts = alts
		else delete out.fileAlts
	}
	else delete out.fileAlts

	return out
}
