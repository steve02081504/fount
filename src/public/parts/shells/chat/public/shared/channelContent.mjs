import { parseEmojiToken } from './inlineTokenSyntax.mjs'
import { sanitizeAlt, sanitizeMessageExtras } from './messageFields.mjs'

/**
 * @param {object} content wire content
 * @returns {Record<string, unknown> | undefined} extension.chat
 */
export function chatExtensionOf(content) {
	return content?.extension?.chat
}

/**
 * @param {object} content wire content
 * @returns {'text' | 'sticker' | 'vote' | 'group_invite' | 'call'} 类别
 */
export function channelMessageKind(content) {
	const type = content?.type
	if (!type || type === 'text') return 'text'
	if (['sticker', 'vote', 'group_invite', 'call'].includes(type)) return type
	throw new Error(`unknown content.type: ${type}`)
}

/**
 * @param {unknown} files 落盘 files
 * @returns {object[] | undefined} 校验后的描述符
 */
function normalizeWireFiles(files) {
	if (!files?.length) return undefined
	const out = []
	for (const file of files) {
		const fileId = file.fileId || ''
		if (!fileId) continue
		const description = sanitizeAlt(file.description)
		out.push({
			fileId,
			name: String(file.name || 'file').slice(0, 255),
			mime_type: String(file.mime_type || 'application/octet-stream'),
			size: Math.max(0, Number(file.size) || 0),
			...description ? { description } : {},
		})
	}
	return out.length ? out : undefined
}

/**
 * @param {Record<string, unknown>} out 待清洗对象
 * @returns {Record<string, unknown>} 去掉空展示字段
 */
function trimCommon(out) {
	const cleaned = sanitizeMessageExtras(out)
	if (!(cleaned.name || '')) delete cleaned.name
	if (!(cleaned.avatar || '')) delete cleaned.avatar
	const files = normalizeWireFiles(cleaned.files)
	if (files) cleaned.files = files
	else delete cleaned.files
	return cleaned
}

/**
 * @param {object} input wire 片段
 * @param {Record<string, unknown>} fields 类型字段
 * @returns {Record<string, unknown>} 带展示字段的 wire
 */
function withDisplayFields(input, fields) {
	return trimCommon({
		...fields,
		...input.extension ? { extension: input.extension } : {},
		...input.name ? { name: input.name } : {},
		...input.avatar ? { avatar: input.avatar } : {},
	})
}

/**
 * 构造文本类 wire。
 * @param {string} agentText 正文
 * @param {Record<string, unknown>} [extra] 其它字段
 * @returns {Record<string, unknown>} 文本 wire
 */
export function channelMessage(agentText, extra = {}) {
	const { content_for_show, content_for_edit, ...rest } = extra
	delete rest.type
	return normalizeChannelMessage({
		...rest,
		content: agentText,
		...content_for_show != null ? { content_for_show: String(content_for_show) } : {},
		...content_for_edit != null ? { content_for_edit: String(content_for_edit) } : {},
	})
}

/**
 * @param {object} input wire
 * @returns {Record<string, unknown>} 文本 wire
 */
function normalizeTextContent(input) {
	if (typeof input.content !== 'string')
		throw new Error('text content requires string content field')
	const out = trimCommon({ ...input, content: input.content })
	delete out.type
	if (out.content_for_show === out.content) delete out.content_for_show
	if (out.content_for_edit === out.content) delete out.content_for_edit
	return out
}

/**
 * @param {object} input wire
 * @returns {Record<string, unknown>} sticker wire
 */
function normalizeStickerContent(input) {
	const emojiRef = input.emojiRef || ''
	const stickerBase64 = input.stickerBase64 || ''
	if (!emojiRef && !stickerBase64) throw new Error('sticker requires emojiRef or stickerBase64')
	const compactEmoji = !!parseEmojiToken(emojiRef)
	return withDisplayFields(input, {
		type: 'sticker',
		...compactEmoji || emojiRef ? { emojiRef } : {},
		...!compactEmoji && stickerBase64 ? { stickerBase64 } : {},
		stickerId: input.stickerId || '',
		stickerName: input.stickerName || '',
		...!compactEmoji && input.mimeType ? { mimeType: String(input.mimeType) } : {},
	})
}

/**
 * @param {object} input wire
 * @returns {Record<string, unknown>} vote wire
 */
function normalizeVoteContent(input) {
	if (!(input.question || '')) throw new Error('vote requires question')
	if (!input.options?.length) throw new Error('vote requires options')
	return withDisplayFields(input, {
		type: 'vote',
		question: String(input.question),
		options: input.options.map(String),
		...input.deadline != null ? { deadline: input.deadline } : {},
	})
}

/**
 * @param {object} input wire
 * @returns {Record<string, unknown>} group_invite wire
 */
function normalizeGroupInviteContent(input) {
	if (!input.groupId) throw new Error('group_invite requires groupId')
	return withDisplayFields(input, {
		type: 'group_invite',
		groupId: input.groupId,
		inviteCode: input.inviteCode || '',
		groupName: (input.groupName || '').slice(0, 100),
		description: (input.description ?? '').slice(0, 200),
		...input.memberCount != null
			? { memberCount: Math.max(0, Math.floor(Number(input.memberCount))) }
			: {},
	})
}

/**
 * @param {object} input wire
 * @returns {Record<string, unknown>} call wire
 */
function normalizeCallContent(input) {
	return withDisplayFields(input, {
		type: 'call',
		callId: input.callId || '',
		status: String(input.status || 'ongoing'),
		...input.startedAt != null ? { startedAt: Number(input.startedAt) } : {},
		...input.endedAt != null ? { endedAt: Number(input.endedAt) } : {},
		...input.duration != null ? { duration: Number(input.duration) } : {},
		...input.initiator != null ? { initiator: String(input.initiator) } : {},
		...Array.isArray(input.participants) ? { participants: input.participants.map(String) } : {},
		...Array.isArray(input.current) ? { current: input.current.map(String) } : {},
	})
}

/**
 * 规范化 DAG wire content。
 * @param {object} input 写入 DAG 的 content
 * @returns {Record<string, unknown>} 校验后的对象
 */
export function normalizeChannelMessage(input) {
	const type = input.type || 'text'
	switch (type) {
		case 'text': return normalizeTextContent(input)
		case 'sticker': return normalizeStickerContent(input)
		case 'vote': return normalizeVoteContent(input)
		case 'group_invite': return normalizeGroupInviteContent(input)
		case 'call': return normalizeCallContent(input)
		default: throw new Error(`unknown content.type: ${type}`)
	}
}

/** 历史发图注入的 `[image:name|url]` 标记（已废止，投影时剥离）。 */
const INLINE_IMAGE_MARKER_RE = /\[image:[^\]|]+\|[^\]]+]/g

/**
 * 剥离历史 `[image:…]` 内联标记（DAG 已落盘消息兼容）。
 * @param {string} text 原文
 * @returns {string} 清洗后文本
 */
export function stripInlineImageMarkers(text) {
	if (!INLINE_IMAGE_MARKER_RE.test(text)) return text
	INLINE_IMAGE_MARKER_RE.lastIndex = 0
	return text
		.replace(/(\n)?\[image:[^\]|]+\|[^\]]+\](\n)?/g, (match, before, after) => before && after ? '\n' : '')
		.replace(/^\n+|\n+$/g, '')
}

/**
 * 展示/agent 文本：未知 type（联邦垃圾）返回空串，不抛。
 * @param {object} content wire
 * @returns {string} agent / 回退正文
 */
export function messageAgentText(content) {
	const type = content?.type
	if (type === 'vote') return content.question || ''
	if (type === 'call') return content.status === 'ended' ? 'Call ended' : 'Call in progress'
	if (type === 'sticker') return String(content.emojiRef || content.stickerName || '')
	if (type === 'group_invite') return String(content.groupName || content.groupId || '')
	if (type && type !== 'text') return ''
	return stripInlineImageMarkers(String(content?.content ?? ''))
}

/**
 * @param {object} content wire
 * @returns {string} 展示正文
 */
export function messageShowText(content) {
	const type = content?.type
	if (type === 'sticker' || type === 'group_invite') return ''
	if (type === 'vote' || type === 'call') return messageAgentText(content)
	if (type && type !== 'text') return ''
	return stripInlineImageMarkers(String(content?.content_for_show ?? content?.content ?? ''))
}

/**
 * @param {object} content wire
 * @returns {string} 编辑正文
 */
export function messageEditText(content) {
	if (content?.type && content.type !== 'text') return ''
	return stripInlineImageMarkers(String(content?.content_for_edit ?? content?.content ?? ''))
}

/**
 * @param {object} messageLine 频道消息行
 * @param {{ onlyMessageTypes?: boolean }} [options] 选项
 * @returns {string} 展示正文
 */
export function messageLineShowText(messageLine, { onlyMessageTypes = false } = {}) {
	if (messageLine?.decryptView?.failed) return ''
	const type = messageLine?.type
	if (type === 'message_delete') return ''
	if (type === 'message_edit')
		return messageShowText(messageLine.content?.newContent ?? messageLine.content)
	if (onlyMessageTypes && type !== 'message') return ''
	return messageShowText(messageLine.content)
}

/**
 * wire → fount 面字段（不含 files buffer 惰性化；由 hydration 处理 files）。
 * @param {object} wire DAG content
 * @returns {object} fount 投影
 */
export function wireToFountFields(wire) {
	const content = messageAgentText(wire)
	const out = { content }
	if (!wire.type || wire.type === 'text') {
		const show = messageShowText(wire)
		const edit = messageEditText(wire)
		if (show && show !== content) out.content_for_show = show
		if (edit && edit !== content) out.content_for_edit = edit
	}
	for (const key of ['name', 'avatar', 'role', 'locale', 'content_warning', 'visibility', 'extension'])
		if (wire[key] != null) out[key] = wire[key]
	if (wire.sensitive_media) out.sensitive_media = true
	if (wire.is_generating) out.is_generating = true
	if (wire.charVisibility?.length) out.charVisibility = wire.charVisibility
	if (wire.files?.length) out.files = wire.files
	return out
}
