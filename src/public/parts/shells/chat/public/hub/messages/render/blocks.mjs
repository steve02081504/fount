/**
 * 【文件】public/hub/messages/render/blocks.mjs
 * 【职责】特殊内容块：解密占位、贴纸、群邀请、引用条。
 */
import { renderTemplateAsHtmlString } from '../../../../../../scripts/features/template.mjs'
import { resolveEmojiUrlBestEffort } from '../../../src/emojiCache.mjs'
import { buildInviteJoinShareUrl } from '../../../src/inviteQr.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { resolveDisplayParentEventId } from '../../../src/ui/channelDisplay.mjs'
import { authorPresentationKeys } from '../../core/domUtils.mjs'
import { hubStore } from '../../core/state.mjs'

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
 * 渲染贴纸消息块（`content.type === 'sticker'`）。
 * @param {object} message 消息行
 * @returns {Promise<string | null>} HTML 或 null（非贴纸时）
 */
export async function renderStickerBlock(message) {
	const content = message?.content
	if (!content) return null
	if (content.type !== 'sticker') return null
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
export async function renderGroupInviteBlock(message) {
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
 * @param {object} message 消息行
 * @param {object[]} allMessages 频道全部行
 * @returns {Promise<string>} 引用条 HTML
 */
export async function renderMessageRefBlockHtml(message, allMessages) {
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
		void import('../messages.mjs').then(({ scrollToMessageEventId }) => scrollToMessageEventId(parentId))
	})
}
