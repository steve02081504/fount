/**
 * 频道消息扩展字段清洗（locale / content_warning / sensitive_media / extension.chat.replyTo|forwardedFrom）。
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
 *
 */
export const REPLY_PREVIEW_MAX = 120
/**
 *
 */
export const REPLY_SENDER_NAME_MAX = 100

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
 * @param {unknown} raw 内联引用元数据
 * @returns {{ eventId: string, senderName?: string, preview?: string } | undefined} 清洗后
 */
export function sanitizeReplyTo(raw) {
	if (!raw || typeof raw !== 'object') return undefined
	const src = /** @type {Record<string, unknown>} */ raw
	const eventId = String(src.eventId || '').trim().toLowerCase()
	if (!/^[0-9a-f]{64}$/.test(eventId)) return undefined
	const out = {
		eventId,
		...src.senderName != null
			? { senderName: String(src.senderName).trim().slice(0, REPLY_SENDER_NAME_MAX) }
			: {},
		...src.preview != null
			? { preview: String(src.preview).replace(/\s+/g, ' ').trim().slice(0, REPLY_PREVIEW_MAX) }
			: {},
	}
	if (!out.senderName) delete out.senderName
	if (!out.preview) delete out.preview
	return out
}

/**
 * 保证 `content.extension.chat` 为对象并返回该对象。
 * @param {Record<string, unknown>} content 消息 content
 * @returns {Record<string, unknown>} chat 侧车
 */
export function ensureChatExtension(content) {
	if (!content.extension || typeof content.extension !== 'object')
		content.extension = {}
	const ext = /** @type {Record<string, unknown>} */ content.extension
	if (!ext.chat || typeof ext.chat !== 'object')
		ext.chat = {}
	return /** @type {Record<string, unknown>} */ ext.chat
}

/**
 * 将展示/侧车字段写入消息（就地规范后返回新对象）。
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

	delete out.embeds
	delete out.fileIds
	delete out.fileCount
	delete out.fileAlts
	delete out.displayName
	delete out.displayAvatar
	if (!['sticker', 'vote', 'group_invite', 'call'].includes(out.type)) delete out.type

	if (out.extension && typeof out.extension === 'object') {
		const ext = { .../** @type {Record<string, unknown>} */ out.extension }
		const chatRaw = ext.chat && typeof ext.chat === 'object'
			? { .../** @type {Record<string, unknown>} */ ext.chat }
			: {}

		const forwardedFrom = sanitizeForwardedFrom(chatRaw.forwardedFrom ?? out.forwardedFrom)
		if (forwardedFrom) chatRaw.forwardedFrom = forwardedFrom
		else delete chatRaw.forwardedFrom

		const replyTo = sanitizeReplyTo(chatRaw.replyTo ?? out.replyTo)
		if (replyTo) chatRaw.replyTo = replyTo
		else delete chatRaw.replyTo

		delete out.forwardedFrom
		delete out.replyTo

		if (Object.keys(chatRaw).length) ext.chat = chatRaw
		else delete ext.chat

		out.extension = Object.keys(ext).length ? ext : undefined
		if (!out.extension) delete out.extension
	}
	else {
		delete out.forwardedFrom
		delete out.replyTo
	}

	return out
}
