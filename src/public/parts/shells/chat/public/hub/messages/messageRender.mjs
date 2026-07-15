/**
 * 【文件】public/hub/messages/messageRender.mjs
 * 【职责】单条频道消息的 HTML 生成：Markdown 预处理、模板块、反应条、嵌入守卫与生成中状态判定。
 * 【原理】输出可插入 `#hub-messages` 的气泡 DOM 结构（头像区、操作条占位、时间分组）；核心：`renderChannelMessageBlock`、`renderMessageContent`、`hydrateMessageMarkdown`、`localizeRenderedMessages`；不直接监听 WS。
 * 【数据结构】hubStore（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】../../../../../scripts/template、../../src/chatMarkdown、../../src/chatMarkdownConvertor、../../src/customEmojis、../../src/groupFileBlob、../../src/groupMode、../../src/inviteQr、../../src/lib/channelContent。
 */
import {
	createDocumentFragmentFromHtmlStringNoScriptActivation,
	renderTemplateAsHtmlString,
} from '../../../../../scripts/features/template.mjs'
import { bindContentReveal, wrapContentWarningHtml, wrapSensitiveMediaHtml } from '/scripts/features/contentReveal/index.mjs'
import { geti18n } from '../../../../../scripts/i18n/index.mjs'
import { channelMessageEditText, channelMessageShowText } from '../../shared/channelContent.mjs'
import { buildMentionLabelMapFromHubState, expandMentionsInMarkdown } from '../../shared/expandMentions.mjs'
import { firstCustomEmojiRef } from '../../src/customEmojis.mjs'
import { resolveEmojiUrlBestEffort } from '../../src/emojiCache.mjs'
import { fetchGroupFileAsBlobUrl } from '../../src/groupFileBlob.mjs'
import {
	attachOffscreenEmbedGuard,
	attachUntrustedMarkdownOffscreenGuard,
	combineDisposers,
} from '../../src/groupMode.mjs'
import { buildInviteJoinShareUrl } from '../../src/inviteQr.mjs'
import { getFountMessageMarkdownConvertor } from '../../src/lib/fountMessageMarkdown.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { tallyVoteChoices } from '../../src/lib/voteTally.mjs'
import { isTrustedAuthor } from '../../src/trustedAuthors.mjs'
import { resolveDisplayParentEventId, tallyReactionsFromMap } from '../../src/ui/channelDisplay.mjs'
import { mountMdRevealButton } from '../../src/ui/mdRevealButton.mjs'
import { isFirstMessageInAuthorGroup } from '/parts/shells:chat/shared/hashAvatar.mjs'
import { authorPresentationKeys, avatarColor, avatarInitial, avatarTextColor, formatTimeAttrs, timeI18nAttrFragment } from '../core/domUtils.mjs'
import { hubStore } from '../core/state.mjs'

import { renderMessageActionsHtml } from './messageActionsRender.mjs'

/** 未信任远端 Markdown 预览字数（与 mention inbox `textPreview` 对齐）。 */
const UNTRUSTED_REMOTE_PREVIEW_LEN = 120

/**
 * @param {string} text 原始正文
 * @param {number} maxLen 上限
 * @returns {string} 截断后正文（超长加省略号）
 */
function truncateTextPreview(text, maxLen) {
	const s = String(text || '')
	if (s.length <= maxLen) return s
	const cut = s.slice(0, maxLen)
	const lastSpace = cut.lastIndexOf(' ')
	const body = lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut
	return `${body}…`
}

/**
 * @param {HTMLElement} bubble 正文气泡
 * @param {string} markdown 已展开 @ 的 Markdown
 * @param {boolean} trusted 是否可信作者（决定 pipeline）
 * @returns {Promise<void>}
 */
async function applyMarkdownToBubble(bubble, markdown, trusted) {
	const processor = await getFountMessageMarkdownConvertor(trusted)
	const html = String(await processor.process({ value: markdown, data: { cache: {} } }))
	bubble.replaceChildren(await createDocumentFragmentFromHtmlStringNoScriptActivation(html))
}

/**
 * @param {string} url 已转义 URL
 * @returns {string} 属性用 URL
 */
function unescapeAttrUrl(url) {
	return url.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
}

/**
 * @param {string} str 源字符串
 * @param {RegExp} regex 全局正则
 * @param {(...args: string[]) => Promise<string>} replacer 替换函数
 * @returns {Promise<string>} 替换后字符串
 */
async function replaceAsync(str, regex, replacer) {
	const parts = []
	let lastIndex = 0
	for (const match of str.matchAll(regex)) {
		const index = match.index ?? 0
		if (index > lastIndex) parts.push(str.slice(lastIndex, index))
		parts.push(await replacer(...match))
		lastIndex = index + match[0].length
	}
	if (lastIndex < str.length) parts.push(str.slice(lastIndex))
	return parts.join('')
}

/** @type {WeakMap<HTMLElement, () => void>} */
const embedGuardDisposers = new WeakMap()

/**
 * @param {object} message 消息行
 * @returns {boolean} 是否为流式生成占位
 */
export function isChannelMessageGenerating(message) {
	if (message?.type !== 'message') return false
	if (message.content?.streamGenerationFailed) return false
	return message.content?.is_generating === true
}

/**
 * @param {object} message 消息行
 * @param {object} renderOpts 渲染选项
 * @returns {boolean} 是否为本机用户消息（右对齐）
 */
function isOwnViewerMessage(message, renderOpts) {
	if (message.charId) return false
	if (message.isRemote) return false
	const viewer = String(renderOpts.viewerPubKeyHash || '').trim().toLowerCase()
	const author = String(message.authorPubKeyHash || '').trim().toLowerCase()
	if (viewer && author) return viewer === author
	return !message.charId
}

/**
 * 从消息对象中提取纯文本内容（不含 GSH 解密占位，见 `renderDecryptBodyHtml`）。
 * @param {{ content?: * }} message 群组或频道消息
 * @returns {string} 展示用文本
 */
export function getMessageText(message) {
	if (message?.decryptView?.failed) return ''
	const content = message?.content
	return channelMessageShowText(content)
}

/**
 * @param {object} message 消息行
 * @returns {string} 编辑用正文（`content_for_edit` 回落 `content`）
 */
export function getMessageEditText(message) {
	return channelMessageEditText(message?.content)
}

/**
 * GSH 解密等待/失败时的占位 HTML（`data-i18n`）。
 * @param {{ content?: * }} message 消息对象
 * @returns {Promise<string>} HTML 片段
 */
async function renderDecryptBodyHtml(message) {
	if (message?.decryptView?.failed) {
		const pendingGen = message.decryptView.pendingGeneration
		return renderTemplateAsHtmlString('hub/messages/decrypt_body', {
			mode: pendingGen != null ? 'pending' : 'failed',
			generation: pendingGen,
		})
	}
	return ''
}

/**
 * 渲染 DAG `fileIds` 中非图片附件（图片优先走正文 `[image:…]` 标记）。
 * @param {object} message 消息行
 * @returns {Promise<string>} HTML 片段
 */
const LAZY_MEDIA_BYTES = 2 * 1024 * 1024

/**
 * @param {string} groupId 群 ID
 * @param {string} id 文件 ID
 * @param {object} meta 文件元数据
 * @param {string} mime MIME
 * @param {string} [alt] 图片 alt 文本
 * @returns {Promise<string>} 单附件 HTML
 */
async function renderSingleFileAttachmentHtml(groupId, id, meta, mime, alt) {
	const fileName = escapeHtml(meta.name || id)
	if (mime.startsWith('image/')) {
		const blobUrl = await fetchGroupFileAsBlobUrl(groupId, id)
		if (!blobUrl)
			return renderTemplateAsHtmlString('hub/messages/media_error', {})
		return renderTemplateAsHtmlString('hub/messages/inline_image', {
			fileName,
			src: escapeHtml(blobUrl),
			alt: escapeHtml(alt || meta.description || ''),
		})
	}
	const size = Number(meta.size) || 0
	const lazy = size > LAZY_MEDIA_BYTES
	if (mime.startsWith('video/') || mime.startsWith('audio/')) {
		if (lazy)
			return renderTemplateAsHtmlString('hub/messages/media_placeholder', {
				fileId: escapeHtml(id),
				fileName,
				mimeType: escapeHtml(mime),
			})
		const blobUrl = await fetchGroupFileAsBlobUrl(groupId, id)
		if (!blobUrl)
			return renderTemplateAsHtmlString('hub/messages/media_error', {})
		if (mime.startsWith('video/'))
			return renderTemplateAsHtmlString('hub/messages/inline_video', { src: escapeHtml(blobUrl) })
		return renderTemplateAsHtmlString('hub/messages/inline_audio', { src: escapeHtml(blobUrl) })
	}
	if (lazy)
		return renderTemplateAsHtmlString('hub/messages/media_placeholder', {
			fileId: escapeHtml(id),
			fileName,
			mimeType: escapeHtml(mime || 'application/octet-stream'),
		})
	const label = fileName
	return `<button type="button" class="btn btn-xs btn-ghost hub-message-file-download" data-group-file-id="${escapeHtml(id)}">${label}</button>`
}

/**
 * 渲染 DAG `fileIds` 附件区（图/音视频/懒加载/下载）。
 * @param {object} message 消息行
 * @returns {Promise<string>} HTML 片段
 */
async function renderMessageFileIdsHtml(message) {
	const fileIds = message.content?.fileIds
	const fileAlts = message.content?.fileAlts || {}
	const groupId = hubStore.context.currentGroupId
	if (!groupId || !Array.isArray(fileIds) || !fileIds.length) return ''

	const text = getMessageText(message)
	const rows = []
	for (const fileId of fileIds) {
		const id = String(fileId || '').trim()
		if (!id) continue
		const metaR = await fetch(
			`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/files/${encodeURIComponent(id)}/meta`,
			{ credentials: 'include' },
		)
		if (!metaR.ok) {
			rows.push(await renderTemplateAsHtmlString('hub/messages/media_error', {}))
			continue
		}
		const meta = await metaR.json()
		const mime = String(meta.mimeType || '')
		if (mime.startsWith('image/') && text.includes('[image:')) continue
		const alt = fileAlts[id] || meta.description || ''
		rows.push(await renderSingleFileAttachmentHtml(groupId, id, meta, mime, alt))
	}
	if (!rows.length) return ''
	return `<div class="hub-message-files flex flex-col gap-1 mt-1">${rows.join('')}</div>`
}

/**
 * @param {object} message 消息行
 * @param {object[]} allMessages 频道全部行
 * @returns {Promise<string>} 引用条 HTML
 */
async function renderMessageRefBlockHtml(message, allMessages) {
	const parentId = resolveDisplayParentEventId(message, allMessages)
	if (!parentId) return ''
	const parent = allMessages.find(
		row => String(row.eventId || '').trim().toLowerCase() === String(parentId).toLowerCase(),
	)
	if (!parent) return ''
	const { displayName } = authorPresentationKeys(parent.charId ?? parent.sender ?? '?')
	const preview = escapeHtml(getMessageText(parent).replace(/\s+/g, ' ').trim().slice(0, 120) || '…')
	return renderTemplateAsHtmlString('hub/messages/ref_block', {
		parentEventId: escapeHtml(String(parentId)),
		author: escapeHtml(displayName),
		preview,
	})
}

/**
 * 将纯文本转为可插入消息区的 HTML（贴纸/图片占位等）。
 * @param {string} text 原始消息文本
 * @returns {Promise<string>} 带内联标签的 HTML
 */
export async function renderMessageContent(text) {
	let html = escapeHtml(text)
	html = await replaceAsync(html, /\[sticker:([^\]|]+)\|([^\]]+)]/g, async (...[, stickerId, stickerUrl]) =>
		renderTemplateAsHtmlString('hub/messages/inline_sticker_img', {
			stickerId: escapeHtml(stickerId),
			src: escapeHtml(unescapeAttrUrl(stickerUrl)),
		}),
	)
	html = await replaceAsync(html, /\[image:([^\]|]+)\|([^\]]+)]/g, async (...[, fileName, imageUrl]) => {
		const safeUrl = escapeHtml(unescapeAttrUrl(imageUrl))
		return renderTemplateAsHtmlString('hub/messages/inline_image', {
			fileName: escapeHtml(fileName),
			src: safeUrl,
		})
	})
	return html
}

/**
 * 渲染贴纸消息块（`content.type === 'sticker'`）。
 * @param {object} message 消息行
 * @returns {Promise<string | null>} HTML 或 null（非贴纸时）
 */
async function renderStickerBlock(message) {
	const content = message?.content
	if (!content) return null
	const isSticker = content.type === 'sticker'
	if (!isSticker) return null
	let src = content.stickerBase64 || ''
	if (!src && content.emojiRef) {
		const refMatch = /:\[([\w.-]+)\/([\w.-]+)]:/.exec(String(content.emojiRef))
		if (refMatch)
			src = await resolveEmojiUrlBestEffort(refMatch[1], refMatch[2]) || ''
	}
	const name = escapeHtml(content.stickerName || content.stickerId || 'sticker')
	if (src.startsWith('data:') || src.startsWith('https://') || src.startsWith('http://') || src.startsWith('/'))
		return renderTemplateAsHtmlString('hub/messages/sticker_block', { src: escapeHtml(src), name })
	return renderTemplateAsHtmlString('hub/messages/sticker_block_fallback', { name })
}

/**
 * 渲染群链接 overlay 块（`content.type === 'group_invite'`）。
 * @param {object} message 消息行
 * @returns {Promise<string | null>} HTML 或 null（非群链接时）
 */
async function renderGroupInviteBlock(message) {
	const content = message?.content
	if (content?.type !== 'group_invite') return null
	const groupId = escapeHtml(content.groupId || '')
	const inviteCode = escapeHtml(content.inviteCode || '')
	const groupName = escapeHtml(content.groupName || groupId)
	const descriptionText = escapeHtml(content.description ?? '')
	const memberCount = content.memberCount != null ? Number(content.memberCount) : null
	const countHtml = memberCount != null && Number.isFinite(memberCount)
		? await renderTemplateAsHtmlString('hub/messages/invite_member_count', { count: memberCount })
		: ''
	const settings = hubStore.context.currentState?.groupSettings
	const roomSecret = content.groupId === hubStore.context.currentGroupId
		? settings?.roomSecret?.trim()
		: ''
	const joinUrl = roomSecret
		? escapeHtml(buildInviteJoinShareUrl(content.groupId, content.inviteCode, roomSecret))
		: ''
	return renderTemplateAsHtmlString('hub/messages/group_invite_card', {
		groupId,
		inviteCode,
		groupName,
		descriptionHtml: descriptionText
			? await renderTemplateAsHtmlString('hub/messages/invite_description', { description: descriptionText })
			: '',
		countHtml,
		joinUrl,
		inviteLinkUnavailable: roomSecret ? '' : '1',
	})
}

/**
 * 渲染投票消息块。
 * @param {object} message 投票行
 * @param {object[]} allMessages 同频道全部行
 * @returns {Promise<string>} HTML
 */
async function renderVoteBlock(message, allMessages) {
	const content = message?.content || {}
	const question = escapeHtml(String(content.question || ''))
	const options = Array.isArray(content.options) ? content.options : []
	const ballotId = escapeHtml(String(message.eventId))
	const counts = tallyVoteChoices(allMessages, message.eventId)
	const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
	const closed = content.deadline && Date.parse(content.deadline) <= Date.now()
	const deadlineHtml = content.deadline
		? await renderTemplateAsHtmlString('hub/messages/vote_deadline', { deadline: String(content.deadline) })
		: ''
	const voteOptions = options.map(label => {
		const key = String(label)
		const voteCount = counts.get(key) || 0
		const percent = total ? Math.round(voteCount * 100 / total) : 0
		return {
			choice: escapeHtml(key),
			label: escapeHtml(key),
			count: voteCount,
			percent,
			disabled: closed ? 'disabled' : '',
		}
	})
	const questionHtml = question || '<span data-i18n="chat.hub.messagePrefixVote"></span>'
	return renderTemplateAsHtmlString('hub/messages/vote_block', {
		ballotId,
		questionHtml,
		deadlineHtml,
		voteOptions,
		total,
		closedClass: closed ? ' hub-vote-block--closed' : '',
		closedLabel: closed ? '<div class="hub-vote-closed-label" data-i18n="chat.hub.voteClosed"></div>' : '',
	})
}

/**
 * @param {object} message 消息行
 * @returns {Promise<string>} HTML
 */
async function renderCallBlock(message) {
	const content = message?.content || {}
	const status = content.status === 'ended' ? 'ended' : 'ongoing'
	const source = status === 'ongoing' && Array.isArray(content.current) && content.current.length
		? content.current
		: (Array.isArray(content.participants) ? content.participants : [])
	const hashes = source.map(h => String(h || '').toLowerCase()).filter(Boolean)
	const avatarsHtml = hashes.slice(0, 12).map(hash =>
		`<span class="hub-call-avatar hub-avatar-wrap" data-avatar-for="${escapeHtml(hash)}" title="${escapeHtml(hash.slice(0, 8))}">${escapeHtml(hash.slice(0, 2))}</span>`,
	).join('')
	let metaHtml = ''
	if (status === 'ongoing') {
		const started = Number(content.startedAt) || 0
		const timeText = started ? new Date(started).toLocaleTimeString() : ''
		metaHtml = `<span data-i18n="chat.hub.callStartedAt" data-time="${escapeHtml(timeText)}"></span>`
			+ ` · <span data-i18n="chat.hub.callParticipants" data-n="${hashes.length}"></span>`
	}
	else {
		const durationMs = Number(content.duration) || 0
		const secs = Math.max(0, Math.round(durationMs / 1000))
		const mm = String(Math.floor(secs / 60)).padStart(2, '0')
		const ss = String(secs % 60).padStart(2, '0')
		metaHtml = `<span data-i18n="chat.hub.callDuration" data-duration="${mm}:${ss}"></span>`
			+ ` · <span data-i18n="chat.hub.callParticipants" data-n="${hashes.length}"></span>`
	}
	const joinButtonHtml = status === 'ongoing'
		? `<button type="button" class="btn btn-sm btn-primary hub-call-join-btn" data-i18n="chat.hub.callJoin"></button>`
		: ''
	return renderTemplateAsHtmlString('hub/messages/call_block', {
		callId: escapeHtml(String(content.callId || message.eventId || '')),
		status,
		titleI18n: status === 'ended' ? 'chat.hub.callEnded' : 'chat.hub.callInProgress',
		metaHtml,
		avatarsHtml: avatarsHtml || '<span class="hub-call-avatars-empty" data-i18n="chat.hub.callNoParticipants"></span>',
		joinButtonHtml,
	})
}

/**
 * @param {object} message 消息行
 * @param {object[]} allMessages 频道消息
 * @param {Record<string, Record<string, { voters?: string[] }>>} reactionsMap 当前页聚合反应
 * @param {string} viewerMemberId 本机成员 pubKeyHash 或 `local`
 * @param {{ canAddReactions?: boolean }} [opts] 渲染选项
 * @returns {Promise<string>} HTML
 */
export async function renderMessageReactionsHtml(message, reactionsMap, viewerMemberId, opts = {}) {
	const { eventId } = message
	if (!eventId || message.type !== 'message') return ''
	const reactions = tallyReactionsFromMap(reactionsMap, eventId, viewerMemberId)
	if (!reactions.size && !opts.canAddReactions) return ''
	const reactionRows = [...reactions.entries()].map(([emoji, { count, byMe }]) => ({
		mineClass: byMe ? ' badge-primary' : '',
		pressedAttr: byMe ? ' aria-pressed="true"' : ' aria-pressed="false"',
		emoji: escapeHtml(String(emoji)),
		emojiLabel: escapeHtml(String(emoji)),
		count,
	}))
	return renderTemplateAsHtmlString('hub/messages/reactions_row', {
		eventId: escapeHtml(String(eventId)),
		reactionRows,
		canAddReactions: !!opts.canAddReactions,
	})
}

/**
 * 统一渲染 Hub 消息行外壳结构。
 * @param {object} options 渲染参数
 * @param {string} options.rowClass 行 CSS 类
 * @param {string} options.rowAttrs 行 data-* 属性 HTML
 * @param {string} options.avatarFor 头像 data-avatar-for
 * @param {string} options.avatarBg 头像背景色
 * @param {string} options.avatarTextColor 头像文字色
 * @param {string} options.avatarHtml 头像占位文字
 * @param {string} options.headerHtml chat-header 内容
 * @param {string} options.contentHtml chat-bubble 内容
 * @param {string} [options.footerHtml] chat-footer 内容（内联反馈 + 表情反应）
 * @param {string} [options.hoverBarHtml] 悬停浮动操作栏 HTML
 * @param {string} options.align chat-start 或 chat-end
 * @param {string} options.bubbleClass 气泡 DaisyUI 类
 * @param {string} [options.bubbleAttrs] 气泡额外属性
 * @returns {Promise<string>} 单条消息外壳 HTML
 */
async function renderMessageRowShell({
	rowClass,
	rowAttrs,
	avatarFor,
	avatarBg,
	avatarTextColor,
	avatarHtml,
	headerHtml,
	contentHtml,
	footerHtml = '',
	hoverBarHtml = '',
	align = 'chat-start',
	bubbleClass = 'chat-bubble-neutral',
	bubbleAttrs = '',
}) {
	const avatarBlock = await renderTemplateAsHtmlString('hub/messages/avatar_block', {
		avatarFor,
		avatarBg: avatarBg ?? avatarColor(avatarFor),
		avatarTextColor: avatarTextColor ?? avatarTextColor(avatarFor),
		avatarHtml,
	})
	return renderTemplateAsHtmlString('hub/messages/message_row', {
		align,
		rowClass,
		rowAttrs,
		avatarBlock,
		headerHtml,
		bubbleClass,
		bubbleAttrs,
		contentHtml,
		footerHtml,
		hoverBarHtml,
	})
}

/**
 * 渲染投递状态小标记 HTML（✓ / ✓✓）。
 * @param {'pending'|'sent'|'delivered'} status 投递态
 * @param {number} [readCount=0] 已读成员数（>0 升为已读双勾）
 * @returns {string} HTML
 */
function renderDeliveryStatusHtml(status, readCount = 0) {
	if (readCount > 0)
		return `<span class="hub-delivery-status hub-delivery-status--read text-xs opacity-70" title="${readCount}" aria-hidden="true">✓✓</span>`
	if (status === 'delivered')
		return '<span class="hub-delivery-status hub-delivery-status--delivered text-xs opacity-60" aria-hidden="true">✓✓</span>'
	if (status === 'sent')
		return '<span class="hub-delivery-status hub-delivery-status--sent text-xs opacity-40" aria-hidden="true">✓</span>'
	return ''
}

/**
 * 渲染转发消息头 HTML（「转发自 {name}」）。
 * @param {{ senderName?: string, shareUrl?: string, groupId?: string, channelId?: string, eventId?: string }} forwardedFrom 转发来源
 * @returns {string} HTML 片段
 */
function renderForwardedFromHtml(forwardedFrom) {
	const name = escapeHtml(String(forwardedFrom.senderName || ''))
	const raw = geti18n('chat.hub.forwardedFrom')
	const label = (typeof raw === 'string' ? raw : raw?.title) || 'Forwarded from'
	let href = ''
	if (forwardedFrom.shareUrl)
		href = escapeHtml(String(forwardedFrom.shareUrl))
	else if (forwardedFrom.groupId && forwardedFrom.channelId && forwardedFrom.eventId)
		href = `#group:${encodeURIComponent(forwardedFrom.groupId)}:${encodeURIComponent(forwardedFrom.channelId)};${encodeURIComponent(forwardedFrom.eventId)}`
	const nameHtml = href
		? `<a class="hub-forwarded-from-link" href="${href}">${name}</a>`
		: `<span>${name}</span>`
	return `<div class="hub-forwarded-from text-xs opacity-60 mb-1">${escapeHtml(label)} ${nameHtml}</div>`
}

/**
 * 渲染单条频道消息块。
 * @param {object} message 消息
 * @param {string|null} prevAuthorKey 上一条作者键（charId ?? sender）
 * @param {number} prevTime 上一条时间戳
 * @param {object[]} [allMessages] 频道全部行
 * @param {object} [renderOpts] 反应渲染选项
 * @returns {Promise<{ html: string, sender: string|null, time: number }>} 单条 HTML 与分组游标
 */
export async function renderChannelMessageBlock(message, prevAuthorKey, prevTime, allMessages = [], renderOpts = {}) {
	const generating = isChannelMessageGenerating(message)
	const sender = message.sender ?? '?'
	const time = message.hlc?.wall ?? 0
	const authorKey = message.charId ?? sender
	const isFirst = isFirstMessageInAuthorGroup(authorKey, prevAuthorKey, time, prevTime)
	const isOwn = isOwnViewerMessage(message, renderOpts)
	const align = isOwn ? 'chat-end' : 'chat-start'
	const bubbleClass = isOwn ? 'chat-bubble-primary' : 'chat-bubble-neutral'

	const authorAttr = message.authorPubKeyHash
		? ` data-author-pubkey-hash="${escapeHtml(message.authorPubKeyHash)}"`
		: ''
	const charAttr = message.charId ? ` data-char-id="${escapeHtml(String(message.charId))}"` : ''
	const snapDisplay = message.content?.displayName || message.extension?.display?.name
	const snapAvatar = message.content?.displayAvatar || message.extension?.display?.avatar
	const presentation = authorPresentationKeys(authorKey)
	const displayAuthor = snapDisplay || presentation.displayName
	const avatarKey = presentation.profileKey
	const streamingAttr = generating ? ' data-streaming="1"' : ''
	const pendingAttr = message.pending ? ' data-pending="1"' : ''
	const failedAttr = message.sendFailed ? ' data-send-failed="1"' : ''
	const deliveryAttr = message.deliveryStatus ? ` data-delivery-status="${escapeHtml(message.deliveryStatus)}"` : ''
	const msgLocale = message.content?.locale ? ` data-message-locale="${escapeHtml(message.content.locale)}"` : ''
	const rowAttrs = `data-message-id="${escapeHtml(String(message.eventId))}" data-author-key="${escapeHtml(authorKey)}" data-message-type="${escapeHtml(message.type || 'message')}"${message.isRemote ? ' data-is-remote="1"' : ''}${authorAttr}${charAttr}${streamingAttr}${pendingAttr}${failedAttr}${deliveryAttr}${msgLocale}`

	const timeAttrs = formatTimeAttrs(time)
	const typingLabelHtml = generating
		? '<span class="hub-streaming-typing inline-flex items-center gap-1 text-base-content/60 text-xs"><span class="loading loading-dots loading-xs"></span><span data-i18n="chat.hub.charTyping"></span></span>'
		: ''

	const emojiRef = firstCustomEmojiRef(getMessageText(message))
	const remoteBadge = message.isRemote
		? await renderTemplateAsHtmlString('hub/messages/remote_badge', {})
		: ''
	const trustButton = message.isRemote && message.authorPubKeyHash
		? await renderTemplateAsHtmlString('hub/messages/trust_author_button', { pubKeyHash: escapeHtml(message.authorPubKeyHash) })
		: ''
	const blockButton = message.isRemote && message.authorPubKeyHash
		? await renderTemplateAsHtmlString('hub/messages/block_author_button', { pubKeyHash: escapeHtml(message.authorPubKeyHash) })
		: ''
	const saveEmojiButton = emojiRef
		? await renderTemplateAsHtmlString('hub/messages/save_emoji_button', {
			groupId: escapeHtml(emojiRef.groupId),
			emojiId: escapeHtml(emojiRef.emojiId),
		})
		: ''

	const editedLabelHtml = message.wasEdited
		? '<span class="text-xs opacity-50 ml-1" data-i18n="chat.hub.editedLabel"></span>'
		: ''
	const headerHtml = await renderTemplateAsHtmlString('hub/messages/channel_header', {
		authorKey: escapeHtml(authorKey),
		author: escapeHtml(displayAuthor),
		editedLabelHtml,
		timeI18nAttr: timeI18nAttrFragment(timeAttrs),
		timeText: escapeHtml(timeAttrs.timeText),
		remoteBadge,
		trustButton,
		blockButton,
		saveEmojiButton,
		typingLabelHtml,
	})
	const refHtml = generating ? '' : await renderMessageRefBlockHtml(message, allMessages)

	let bodyHtml
	let bubbleAttrs = ''
	if (generating)
		bodyHtml = await renderTemplateAsHtmlString('hub/messages/streaming_body', {})
	else {
		const plainText = getMessageText(message)
		const decryptHtml = await renderDecryptBodyHtml(message)
		const truncBanner = message.content?.streamGenerationFailed
			? await renderTemplateAsHtmlString('hub/messages/stream_truncated', {})
			: ''
		const stickerHtml = !decryptHtml ? await renderStickerBlock(message) : null
		const groupInviteHtml = !decryptHtml && !stickerHtml ? await renderGroupInviteBlock(message) : null
		const useCall = !decryptHtml && !stickerHtml && !groupInviteHtml
			&& message.content?.type === 'call'
		const useVote = !decryptHtml && !stickerHtml && !groupInviteHtml && !useCall
			&& message.content?.type === 'vote' && allMessages.length
		const usePlainMd = !decryptHtml && !stickerHtml && !groupInviteHtml && !useVote && !useCall
			&& plainText.length > 0 && message.eventId

		const filesHtml = !decryptHtml && !stickerHtml && !groupInviteHtml && !useVote && !useCall
			? await renderMessageFileIdsHtml(message)
			: ''
		const bodyCore = decryptHtml
			|| stickerHtml
			|| groupInviteHtml
			|| (useCall
				? await renderCallBlock(message)
				: useVote
					? await renderVoteBlock(message, allMessages)
					: await renderMessageContent(plainText))

		// 转发头
		const forwardedFrom = message.content?.forwardedFrom
		const forwardedFromHtml = forwardedFrom
			? renderForwardedFromHtml(forwardedFrom)
			: ''

		const failedBanner = message.sendFailed
			? await renderTemplateAsHtmlString('hub/messages/send_failed_banner', { eventId: escapeHtml(String(message.eventId)) })
			: ''

		let mainBody = `${forwardedFromHtml}${refHtml}${truncBanner}${bodyCore}${filesHtml}${failedBanner}`

		// 内容警告折叠
		if (message.content?.content_warning) {
			const cwLabel = String(message.content.content_warning)
			const raw = geti18n('chat.hub.revealContent')
			const revealLabel = (typeof raw === 'string' ? raw : raw?.title) || 'Reveal'
			mainBody = wrapContentWarningHtml(mainBody, { warningLabel: cwLabel, revealLabel })
		}
		// 敏感媒体遮罩（仅对文件区包裹，正文 inline image 难以单独包裹故也一起包）
		else if (message.content?.sensitive_media && (filesHtml || message.content?.fileIds?.length)) {
			const raw = geti18n('chat.hub.sensitiveMedia')
			const warnLabel = (typeof raw === 'string' ? raw : raw?.title) || ''
			const rawReveal = geti18n('chat.hub.revealMedia')
			const revealLabel = (typeof rawReveal === 'string' ? rawReveal : rawReveal?.title) || 'Reveal'
			mainBody = wrapSensitiveMediaHtml(mainBody, { warningLabel: warnLabel, revealLabel })
		}

		bodyHtml = mainBody

		if (usePlainMd)
			bubbleAttrs = ` data-md-raw="${escapeHtml(plainText)}" data-md-author="${escapeHtml(String(message.authorPubKeyHash || ''))}"`
	}

	const reactionsHtml = generating ? '' : await renderMessageReactionsHtml(
		message,
		renderOpts.reactions || {},
		renderOpts.viewerMemberId || 'local',
		{ canAddReactions: !!renderOpts.canAddReactions && message.type === 'message' },
	)
	const actionsResult = generating ? null : await renderMessageActionsHtml(message, {
		viewerPubKeyHash: renderOpts.viewerPubKeyHash,
		localCharIds: renderOpts.localCharIds,
		localCharId: renderOpts.localCharIds?.[0] ?? renderOpts.localCharId,
		canManageMessages: renderOpts.canManageMessages,
		canPinMessages: renderOpts.canPinMessages,
		canCreateThreads: renderOpts.canCreateThreads,
		pinnedEventIds: renderOpts.pinnedEventIds,
		alwaysVisibleActions: renderOpts.alwaysVisibleActions,
		isLastMessage: renderOpts.lastMessageEventId === message.eventId,
	})
	const hoverBarHtml = actionsResult?.hoverHtml || ''
	const inlineFeedbackHtml = actionsResult?.inlineHtml || ''

	// 投递态指示器（仅己方消息显示）；已读水位覆盖时升为双勾
	let deliveryStatusHtml = ''
	if (!generating && isOwn) {
		const groupId = hubStore.context.currentGroupId
		const channelId = hubStore.context.currentChannelId
		const msgSeq = Number(message.seq)
		let readCount = 0
		if (groupId && channelId && Number.isFinite(msgSeq) && msgSeq > 0) {
			const { getReadCountForMessage } = await import('../memberReadMarkers.mjs')
			readCount = getReadCountForMessage(groupId, channelId, msgSeq)
		}
		deliveryStatusHtml = renderDeliveryStatusHtml(message.deliveryStatus || (message.pending ? 'pending' : 'sent'), readCount)
	}

	return {
		html: await renderMessageRowShell({
			rowClass: `hub-message ${isFirst ? 'first-in-group' : ''}${message.pending ? ' hub-message-pending' : ''}${message.sendFailed ? ' hub-message-send-failed' : ''}`.trim(),
			align,
			bubbleClass,
			rowAttrs,
			avatarFor: avatarKey,
			avatarBg: avatarColor(avatarKey),
			avatarTextColor: avatarTextColor(avatarKey),
			avatarHtml: snapAvatar
				? `<img src="${escapeHtml(String(snapAvatar))}" class="w-full h-full object-cover rounded-full" alt="" />`
				: escapeHtml(avatarInitial(displayAuthor)),
			headerHtml,
			contentHtml: bodyHtml,
			bubbleAttrs,
			footerHtml: `${inlineFeedbackHtml}${reactionsHtml}${deliveryStatusHtml}`,
			hoverBarHtml,
		}),
		sender: authorKey,
		time,
	}
}

/**
 * 消息列表插入 DOM 后翻译动态 `data-i18n` 节点、绑定交互层。
 * @param {HTMLElement} container 消息列表根
 * @returns {void}
 */
export function localizeRenderedMessages(container) {
	wireMessageEmbedGuards(container)
	wireMessageRefBlocks(container)
	wireMessageMediaPlaceholders(container)
	bindContentReveal(container)
	void hydrateMessageMarkdown(container)
	void autoTranslateMessages(container)
}

/**
 * 自动翻译：拉取偏好后，对需要翻译的消息 mount 译文块。
 * @param {HTMLElement} container 消息列表根
 * @returns {Promise<void>}
 */
async function autoTranslateMessages(container) {
	if (!(container instanceof HTMLElement)) return
	try {
		const response = await fetch('/api/parts/shells:chat/translation-prefs', { credentials: 'include' })
		if (!response.ok) return
		const prefs = await response.json()
		if (!prefs?.autoTranslate) return

		const excludeLocales = new Set(Array.isArray(prefs.excludeLocales) ? prefs.excludeLocales : [])
		const { requestTranslation, resolveTargetLang, mountTranslationBlock } = await import('/scripts/features/translate.mjs')
		const { geti18n } = await import('../../../../../scripts/i18n/index.mjs')
		const targetLang = resolveTargetLang()
		/**
		 * @param {string|{title?:string}|undefined} v i18n 值
		 * @returns {string} 字符串表示
		 */
		const extractI18n = v => typeof v === 'string' ? v : v?.title || ''

		const rows = container.querySelectorAll('.chat[data-message-id][data-message-locale]')
		for (const row of rows) {
			if (!(row instanceof HTMLElement)) continue
			const locale = row.getAttribute('data-message-locale') || ''
			if (!locale || excludeLocales.has(locale)) continue
			if (locale.toLowerCase().startsWith(targetLang.toLowerCase().split('-')[0])) continue
			const bubble = row.querySelector('.hub-message-content')
			if (!(bubble instanceof HTMLElement)) continue
			if (bubble.querySelector('.translation-block')) continue

			const text = bubble.textContent?.trim() || ''
			if (!text) continue
			try {
				const translated = await requestTranslation('/api/parts/shells:chat/translate', text, targetLang)
				mountTranslationBlock(bubble, {
					originalText: text,
					translatedText: translated,
					showOriginalLabel: extractI18n(geti18n('chat.hub.translateShowOriginal')) || 'Original',
					showTranslationLabel: extractI18n(geti18n('chat.hub.translateShowTranslation')) || 'Translation',
					translationLabel: extractI18n(geti18n('chat.hub.translateLabel')) || '',
				})
			}
			catch { /* 翻译失败静默跳过 */ }
		}
	}
	catch { /* 偏好拉取失败或端点未就绪 */ }
}

/**
 * @param {HTMLElement} container 消息列表根
 * @returns {void}
 */
export function wireMessageRefBlocks(container) {
	if (container.dataset.refBlocksWired === '1') return
	container.dataset.refBlocksWired = '1'
	container.addEventListener('click', event => {
		const ref = event.target.closest('.hub-message-ref[data-parent-event-id]')
		if (!ref) return
		const parentId = ref.getAttribute('data-parent-event-id')
		if (!parentId) return
		event.preventDefault()
		event.stopPropagation()
		void import('./messages.mjs').then(({ scrollToMessageEventId }) => scrollToMessageEventId(parentId))
	})
}

/**
 * @param {HTMLElement} container 消息列表根
 * @returns {void}
 */
export function wireMessageMediaPlaceholders(container) {
	if (container.dataset.mediaPlaceholdersWired === '1') return
	container.dataset.mediaPlaceholdersWired = '1'
	container.addEventListener('click', async event => {
		const placeholder = event.target.closest('[data-media-placeholder]')
		if (!placeholder || placeholder.dataset.mediaLoaded === '1') return
		const fileId = placeholder.getAttribute('data-group-file-id')
		const groupId = hubStore.context.currentGroupId
		if (!fileId || !groupId) return
		event.preventDefault()
		event.stopPropagation()
		const mime = String(placeholder.getAttribute('data-mime') || '')
		const blobUrl = await fetchGroupFileAsBlobUrl(groupId, fileId)
		if (!blobUrl) {
			placeholder.replaceWith(
				await createDocumentFragmentFromHtmlStringNoScriptActivation(
					await renderTemplateAsHtmlString('hub/messages/media_error', {}),
				).firstElementChild || document.createElement('div'),
			)
			return
		}
		const src = escapeHtml(blobUrl)
		const html = mime.startsWith('video/')
			? await renderTemplateAsHtmlString('hub/messages/inline_video', { src })
			: mime.startsWith('audio/')
				? await renderTemplateAsHtmlString('hub/messages/inline_audio', { src })
				: await renderTemplateAsHtmlString('hub/messages/inline_image', {
					fileName: escapeHtml(placeholder.querySelector('.truncate')?.textContent || fileId),
					src,
				})
		const frag = await createDocumentFragmentFromHtmlStringNoScriptActivation(html)
		const node = frag.firstElementChild
		if (node) placeholder.replaceWith(node)
	})
}

/**
 * 在气泡上挂载离屏守卫（embed + 未信任 Markdown）。
 * @param {HTMLElement} bubble 正文气泡
 * @param {boolean} trusted 是否可信作者
 * @param {string} messageId 消息 id
 * @param {HTMLElement} container 列表根（用于 reveal 后重渲染）
 * @returns {void}
 */
function wireBubbleOffscreenGuards(bubble, trusted, messageId, container) {
	const prev = embedGuardDisposers.get(bubble)
	if (prev) prev()
	if (trusted) {
		bubble.dataset.mdUntrusted = '0'
		embedGuardDisposers.set(bubble, attachOffscreenEmbedGuard(bubble))
		return
	}
	bubble.dataset.mdUntrusted = '1'
	embedGuardDisposers.set(bubble, combineDisposers(
		attachOffscreenEmbedGuard(bubble),
		attachUntrustedMarkdownOffscreenGuard(bubble, {
			/**
			 * 用户确认后重新 hydrate 该条 Markdown。
			 * @returns {void}
			 */
			onReveal: () => {
				bubble.dataset.mdRevealed = '1'
				void hydrateMessageMarkdown(container, messageId)
			},
		}),
	))
}

/**
 * @param {HTMLElement} container 消息列表根
 * @param {string} messageId 消息 id
 * @param {HTMLElement} row 消息行
 * @param {HTMLElement} bubble 正文气泡
 * @returns {Promise<void>}
 */
async function hydrateOneMarkdown(container, messageId, row, bubble) {
	const raw = bubble.dataset.mdRaw || ''
	if (!raw.trim()) return

	const isRemote = row.hasAttribute('data-is-remote')
	const authorPubKeyHash = bubble.dataset.mdAuthor || ''
	const trusted = !isRemote || await isTrustedAuthor(String(authorPubKeyHash))
	const labelMap = buildMentionLabelMapFromHubState(hubStore.context.currentState, hubStore.viewer)

	try {
		if (trusted || bubble.dataset.mdRevealed === '1') {
			await applyMarkdownToBubble(bubble, expandMentionsInMarkdown(raw, labelMap), trusted)
			delete bubble.dataset.mdRaw
			bubble.dataset.mdHydrated = '1'
			bubble.dataset.mdPreview = '0'
			wireBubbleOffscreenGuards(bubble, trusted, messageId, container)
			return
		}

		const previewRaw = truncateTextPreview(raw, UNTRUSTED_REMOTE_PREVIEW_LEN)
		const canExpand = raw.length > UNTRUSTED_REMOTE_PREVIEW_LEN
		await applyMarkdownToBubble(bubble, expandMentionsInMarkdown(previewRaw, labelMap), false)
		bubble.dataset.mdHydrated = '1'
		bubble.dataset.mdPreview = canExpand ? '1' : '0'
		bubble.dataset.mdUntrusted = '1'

		if (canExpand) 
			await mountMdRevealButton(bubble, () => {
				bubble.dataset.mdRevealed = '1'
				void hydrateMessageMarkdown(container, messageId)
			})
		

		wireBubbleOffscreenGuards(bubble, false, messageId, container)
	}
	catch { /* 保留 escape 占位 */ }
}

/**
 * §17：Hub 消息区 Markdown + 可信作者策略。
 * @param {HTMLElement} container 消息列表根
 * @param {string} [onlyMessageId] 仅重渲染指定消息
 * @returns {Promise<void>}
 */
export async function hydrateMessageMarkdown(container, onlyMessageId) {
	if (!(container instanceof HTMLElement)) return
	const rows = onlyMessageId
		? [...container.querySelectorAll(`[data-message-id="${onlyMessageId}"]`)]
		: [...container.querySelectorAll('.chat[data-message-id]')]
	for (const row of rows) {
		const messageId = row.getAttribute('data-message-id')
		if (!messageId) continue
		if (row.hasAttribute('data-streaming')) continue
		const bubble = row.querySelector('.hub-message-content, .chat-bubble.hub-message-content')
		if (!(bubble instanceof HTMLElement)) continue
		if (!bubble.dataset.mdRaw) continue
		if (onlyMessageId) {
			delete bubble.dataset.mdHydrated
			const prev = embedGuardDisposers.get(bubble)
			if (prev) prev()
			embedGuardDisposers.delete(bubble)
		}
		else if (bubble.dataset.mdHydrated === '1')
			continue

		await hydrateOneMarkdown(container, messageId, row, bubble)
	}
}

/**
 * §17：离屏时挂起 iframe/video src，减轻后台嵌入。
 * @param {HTMLElement} container 消息列表根
 * @returns {void}
 */
export function wireMessageEmbedGuards(container) {
	if (!(container instanceof HTMLElement)) return
	for (const bubble of container.querySelectorAll('.hub-message-content')) {
		if (!(bubble instanceof HTMLElement)) continue
		const prev = embedGuardDisposers.get(bubble)
		if (prev) prev()
		embedGuardDisposers.set(bubble, attachOffscreenEmbedGuard(bubble))
	}
}
