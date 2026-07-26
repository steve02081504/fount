import { ensureChatExtension, sanitizeAlt, sanitizeMessageExtras } from './messageFields.mjs'

/**
 * @param {object} content wire content
 * @returns {Record<string, unknown> | undefined} extension.chat
 */
export function chatExtensionOf(content) {
	const chat = content?.extension?.chat
	return chat && typeof chat === 'object' ? chat : undefined
}

/**
 * @param {object} content wire content
 * @returns {'text' | 'sticker' | 'vote' | 'group_invite' | 'call'} 类别
 */
export function channelMessageKind(content) {
	const type = content?.type
	if (type === 'sticker' || type === 'vote' || type === 'group_invite' || type === 'call' || type === 'text')
		return type
	throw new Error(`unknown content.type: ${type}`)
}

/**
 * @param {unknown} files 落盘 files
 * @returns {object[] | undefined} 校验后的描述符
 */
function normalizeWireFiles(files) {
	if (!Array.isArray(files) || !files.length) return undefined
	const out = []
	for (const file of files) {
		if (!file || typeof file !== 'object') continue
		const fileId = String(file.fileId || '').trim()
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
	if (!String(cleaned.name || '').trim()) delete cleaned.name
	if (!String(cleaned.avatar || '').trim()) delete cleaned.avatar
	const files = normalizeWireFiles(cleaned.files)
	if (files) cleaned.files = files
	else delete cleaned.files
	return cleaned
}

/**
 * 构造文本类 wire。
 * @param {string} agentText 正文
 * @param {Record<string, unknown>} [extra] 其它字段
 * @returns {Record<string, unknown>} type:text wire
 */
export function channelMessage(agentText, extra = {}) {
	const { content_for_show, content_for_edit, type: _t, ...rest } = extra
	return normalizeChannelMessage({
		...rest,
		type: 'text',
		content: String(agentText ?? ''),
		...content_for_show != null ? { content_for_show: String(content_for_show) } : {},
		...content_for_edit != null ? { content_for_edit: String(content_for_edit) } : {},
	})
}

/**
 * 规范化 DAG wire content（带 type）。
 * @param {object} input 写入 DAG 的 content
 * @returns {Record<string, unknown>} 校验后的对象
 */
export function normalizeChannelMessage(input) {
	if (!input || typeof input !== 'object')
		throw new Error('channel message requires object content')

	const type = input.type || 'text'
	if (type === 'text') {
		if (typeof input.content !== 'string')
			throw new Error('text content requires string content field')
		const out = trimCommon({ ...input, type: 'text', content: input.content })
		if (out.content_for_show === out.content) delete out.content_for_show
		if (out.content_for_edit === out.content) delete out.content_for_edit
		return out
	}

	if (type === 'sticker') {
		const emojiRef = String(input.emojiRef || '').trim()
		const stickerBase64 = String(input.stickerBase64 || '')
		if (emojiRef && /:\[[\w.-]+\/[\w.-]+\](?!:)/.test(emojiRef)) {
			return trimCommon({
				type: 'sticker',
				emojiRef,
				stickerId: String(input.stickerId || ''),
				stickerName: String(input.stickerName || ''),
				...input.extension ? { extension: input.extension } : {},
				...input.name ? { name: input.name } : {},
				...input.avatar ? { avatar: input.avatar } : {},
			})
		}
		return trimCommon({
			type: 'sticker',
			...emojiRef ? { emojiRef } : {},
			...stickerBase64 ? { stickerBase64 } : {},
			stickerId: String(input.stickerId || ''),
			stickerName: String(input.stickerName || ''),
			...input.mimeType ? { mimeType: String(input.mimeType) } : {},
			...input.extension ? { extension: input.extension } : {},
			...input.name ? { name: input.name } : {},
			...input.avatar ? { avatar: input.avatar } : {},
		})
	}

	if (type === 'vote') {
		if (!String(input.question || '').trim()) throw new Error('vote requires question')
		if (!Array.isArray(input.options) || !input.options.length) throw new Error('vote requires options')
		return trimCommon({
			type: 'vote',
			question: String(input.question),
			options: input.options.map(String),
			...input.deadline != null ? { deadline: input.deadline } : {},
			...input.extension ? { extension: input.extension } : {},
			...input.name ? { name: input.name } : {},
			...input.avatar ? { avatar: input.avatar } : {},
		})
	}

	if (type === 'group_invite') {
		if (!input.groupId) throw new Error('group_invite requires groupId')
		return trimCommon({
			type: 'group_invite',
			groupId: input.groupId,
			inviteCode: input.inviteCode || '',
			groupName: String(input.groupName || '').slice(0, 100),
			description: String(input.description ?? '').slice(0, 200),
			...input.memberCount != null && {
				memberCount: Math.max(0, Math.floor(Number(input.memberCount))),
			},
			...input.extension ? { extension: input.extension } : {},
			...input.name ? { name: input.name } : {},
			...input.avatar ? { avatar: input.avatar } : {},
		})
	}

	if (type === 'call') {
		return trimCommon({
			type: 'call',
			callId: String(input.callId || ''),
			status: String(input.status || 'ongoing'),
			...input.startedAt != null ? { startedAt: Number(input.startedAt) } : {},
			...input.endedAt != null ? { endedAt: Number(input.endedAt) } : {},
			...input.duration != null ? { duration: Number(input.duration) } : {},
			...input.initiator != null ? { initiator: String(input.initiator) } : {},
			...Array.isArray(input.participants) ? { participants: input.participants.map(String) } : {},
			...Array.isArray(input.current) ? { current: input.current.map(String) } : {},
			...input.extension ? { extension: input.extension } : {},
			...input.name ? { name: input.name } : {},
			...input.avatar ? { avatar: input.avatar } : {},
		})
	}

	throw new Error(`unknown content.type: ${type}`)
}

/**
 * @param {object} content wire
 * @returns {string} agent / 回退正文
 */
export function messageAgentText(content) {
	const kind = channelMessageKind(content)
	if (kind === 'vote') return String(content.question || '').trim()
	if (kind === 'call') return content.status === 'ended' ? 'Call ended' : 'Call in progress'
	if (kind === 'sticker') return String(content.emojiRef || content.stickerName || '')
	if (kind === 'group_invite') return String(content.groupName || content.groupId || '')
	return String(content.content ?? '')
}

/**
 * @param {object} content wire
 * @returns {string} 展示正文
 */
export function messageShowText(content) {
	const kind = channelMessageKind(content)
	if (kind === 'text') return String(content.content_for_show ?? content.content ?? '')
	if (kind === 'sticker' || kind === 'group_invite') return ''
	return messageAgentText(content)
}

/**
 * @param {object} content wire
 * @returns {string} 编辑正文
 */
export function messageEditText(content) {
	if (channelMessageKind(content) !== 'text') return ''
	return String(content.content_for_edit ?? content.content ?? '')
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
	const content = messageLine?.content
	if (type === 'message_edit')
		return messageShowText(content?.newContent ?? content)
	if (onlyMessageTypes && type !== 'message') return ''
	return messageShowText(content)
}

/**
 * @param {string} fileName 文件名
 * @param {string} inlineImageUrl 内联图 URL
 * @returns {string} 标记
 */
export function inlineImageMarker(fileName, inlineImageUrl) {
	return `[image:${String(fileName || 'image').replace(/\|/g, '_')}|${inlineImageUrl}]`
}

/**
 * @param {object} content wire
 * @param {string[]} inlineMarkers 标记
 * @param {{ preserveShowEdit?: boolean }} [options] 选项
 * @returns {object} 合并后 wire
 */
export function mergeInlineImageMarkersIntoContent(content, inlineMarkers, { preserveShowEdit = false } = {}) {
	if (!inlineMarkers?.length) return content
	const isText = channelMessageKind(content) === 'text'
	const baseText = isText ? messageAgentText(content) : messageShowText(content)
	const { content: _prev, content_for_show, content_for_edit, ...extra } = normalizeChannelMessage(
		isText ? content : channelMessage(baseText, { ...content, type: 'text' }),
	)
	return channelMessage([baseText, ...inlineMarkers].filter(Boolean).join('\n'), {
		...extra,
		...preserveShowEdit && isText && { content_for_show, content_for_edit },
	})
}

/**
 * wire → fount 面字段（不含 files buffer 惰性化；由 hydration 处理 files）。
 * @param {object} wire DAG content
 * @returns {{ content: string, content_for_show?: string, content_for_edit?: string, locale?: string, content_warning?: string, sensitive_media?: boolean, name?: string, avatar?: string, role?: string, is_generating?: boolean, charVisibility?: string[], visibility?: unknown, files?: object[], extension?: object }} fount 投影
 */
export function wireToFountFields(wire) {
	const kind = channelMessageKind(wire)
	const content = messageAgentText(wire)
	const out = { content }
	if (kind === 'text') {
		const show = messageShowText(wire)
		const edit = messageEditText(wire)
		if (show && show !== content) out.content_for_show = show
		if (edit && edit !== content) out.content_for_edit = edit
	}
	if (wire.name) out.name = String(wire.name)
	if (wire.avatar) out.avatar = String(wire.avatar)
	if (wire.role) out.role = wire.role
	if (wire.locale) out.locale = wire.locale
	if (wire.content_warning) out.content_warning = wire.content_warning
	if (wire.sensitive_media) out.sensitive_media = true
	if (wire.is_generating) out.is_generating = true
	if (wire.charVisibility?.length) out.charVisibility = wire.charVisibility
	if (wire.visibility != null) out.visibility = wire.visibility
	if (wire.files?.length) out.files = wire.files
	if (wire.extension) out.extension = wire.extension
	return out
}
