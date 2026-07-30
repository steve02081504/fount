/**
 * 【文件】public/hub/messages/render/blocks.mjs
 * 【职责】特殊内容块：解密占位、贴纸、群邀请、语义引用气泡。
 */
import { resolvePackEmojiUrl } from '../../../../../../scripts/features/emoji/packIndex.mjs'
import { renderTemplateAsHtmlString } from '../../../../../../scripts/features/template.mjs'
import { channelMessageKind, chatExtensionOf } from '../../../shared/channelContent.mjs'
import { parseEmojiToken } from '../../../shared/inlineTokenSyntax.mjs'
import { buildInviteJoinShareUrl } from '../../../src/inviteQr.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { authorPresentationKeys } from '../../core/domUtils.mjs'
import { store } from '../../core/state.mjs'

import { getMessageText } from './text.mjs'

/**
 * GSH 解密等待/失败时的占位 HTML（`data-i18n`）。
 * @param {{ content?: * }} message 消息对象
 * @returns {Promise<string>} HTML 片段
 */
export async function renderDecryptBodyHtml(message) {
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
 * 渲染贴纸消息块（顶层 `type: 'sticker'`）。
 * @param {object} message 消息行
 * @returns {Promise<string | null>} HTML 或 null（非贴纸时）
 */
export async function renderStickerBlock(message) {
	const content = message?.content
	if (!content || channelMessageKind(content) !== 'sticker') return null
	let src = String(content.stickerBase64 || '')
	const refMatch = parseEmojiToken(content.emojiRef)
	if (!src && refMatch)
		src = await resolvePackEmojiUrl(refMatch.packId, refMatch.emojiId) || ''
	const name = escapeHtml(content.stickerName || content.stickerId || 'sticker')
	const saveButtonHtml = refMatch?.packId
		? '<button type="button" class="save-sticker-button" data-i18n="chat.hub.save.sticker"></button>'
		: ''
	if (src.startsWith('data:') || src.startsWith('https://') || src.startsWith('http://') || src.startsWith('/'))
		return renderTemplateAsHtmlString('hub/messages/sticker_block', { src: escapeHtml(src), name, saveButtonHtml })
	return renderTemplateAsHtmlString('hub/messages/sticker_block_fallback', { name, saveButtonHtml })
}

/**
 * 渲染群链接 overlay 块（顶层 `type: 'group_invite'`）。
 * @param {object} message 消息行
 * @returns {Promise<string | null>} HTML 或 null（非群链接时）
 */
export async function renderGroupInviteBlock(message) {
	const content = message?.content
	if (!content || channelMessageKind(content) !== 'group_invite') return null
	const groupId = escapeHtml(content.groupId || '')
	const inviteCode = escapeHtml(content.inviteCode || '')
	const groupName = escapeHtml(content.groupName || groupId)
	const descriptionText = escapeHtml(content.description ?? '')
	const memberCount = content.memberCount != null ? Number(content.memberCount) : null
	const countHtml = memberCount != null && Number.isFinite(memberCount)
		? await renderTemplateAsHtmlString('hub/messages/invite_member_count', { count: memberCount })
		: ''
	const settings = store.context.currentState?.groupSettings
	const roomSecret = content.groupId === store.context.currentGroupId
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
 * 仅在语义 `extension.chat.replyTo` 存在时渲染引用气泡；不把 DAG `prev_event_ids` 画成引用条。
 * @param {object} message 消息行
 * @param {Map<string, object>} messagesByEventId 页级 eventId→行
 * @returns {Promise<string>} quote 气泡 HTML
 */
export async function renderMessageRefBlockHtml(message, messagesByEventId) {
	const replyTo = chatExtensionOf(message?.content)?.replyTo
	if (!replyTo?.eventId) return ''
	const eventId = String(replyTo.eventId).trim().toLowerCase()
	const parent = messagesByEventId?.get(eventId)
	let author = String(replyTo.senderName || '').trim()
	let previewText = String(replyTo.preview || '').trim()
	if (parent) {
		if (!author) {
			const keys = authorPresentationKeys(parent.charId ?? parent.sender ?? '?')
			author = parent.content?.name || keys.displayName
		}
		if (!previewText)
			previewText = getMessageText(parent).replace(/\s+/g, ' ').trim().slice(0, 120)
	}
	return renderTemplateAsHtmlString('hub/messages/quote_block', {
		parentEventId: escapeHtml(eventId),
		author: escapeHtml(author || '…'),
		preview: escapeHtml(previewText || '…'),
	})
}

/**
 * @param {HTMLElement} container 消息列表根
 * @returns {void}
 */
export function wireMessageRefBlocks(container) {
	if (container.dataset.refBlocksWired === '1') return
	container.dataset.refBlocksWired = '1'
	container.addEventListener('click', event => {
		const ref = event.target.closest('.message-quote[data-parent-event-id]')
		if (!ref) return
		const parentId = ref.getAttribute('data-parent-event-id')
		if (!parentId) return
		event.preventDefault()
		event.stopPropagation()
		void import('../messages.mjs').then(({ scrollToMessageEventId }) => scrollToMessageEventId(parentId))
	})
}
