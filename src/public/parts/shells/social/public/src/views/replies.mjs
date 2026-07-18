import { renderTemplate, renderTemplateAsHtmlString } from '../../../../../scripts/features/template.mjs'
import { formatSocialPostHref, formatSocialProfileHref } from '../../shared/runUri.mjs'
import { formatActionKey } from '../lib/actionKey.mjs'
import { authorLabel, entityHandle, formatTimeHtml, rememberEntityHandle, renderAvatarHtml, renderTrustedPostMarkdown } from '../lib/display.mjs'
import { renderEngagementBarHtml } from '../lib/engagementBar.mjs'
import { socialState } from '../state.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

/**
 * @param {string} actionKey 回复目标 actionKey
 * @returns {Promise<HTMLElement>} 回复 composer
 */
async function buildReplyComposer(actionKey) {
	const avatarHtml = socialState.viewerEntityHash
		? renderAvatarHtml(socialState.viewerEntityHash, socialState.viewerProfile || {
			name: socialState.viewerDisplayName,
		}, 'reply-composer-avatar')
		: ''
	const composer = await renderTemplate('reply_composer', {
		actionKey: escapeHtml(actionKey),
		avatarSlot: avatarHtml
			? `<div class="reply-composer-avatar-slot" aria-hidden="true">${avatarHtml}</div>`
			: '',
	})
	const textarea = composer.querySelector('textarea')
	textarea?.addEventListener('input', () => {
		textarea.style.height = 'auto'
		textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`
	})
	return composer
}

/**
 * 渲染单条回复行（头像、显示名、互动栏）。
 * @param {object} reply 回复 feed item
 * @returns {Promise<HTMLElement>} 回复行
 */
export async function buildReplyRow(reply) {
	const row = document.createElement('div')
	row.className = 'reply'
	const replyId = String(reply.postId || reply.post?.id || '')
	const entityHash = String(reply.entityHash || '')
	if (replyId) row.dataset.replyId = replyId
	row.dataset.authorEntity = entityHash
	const actionKey = formatActionKey(entityHash, replyId)
	const text = reply.post?.content?.text || ''
	const bodyHtml = reply.post?.decryptView?.failed
		? '<em data-i18n="social.feed.decryptFailed"></em>'
		: await renderTrustedPostMarkdown(text, entityHash)
	const engagementBarHtml = await renderEngagementBarHtml(reply, actionKey)
	rememberEntityHandle(entityHash, reply.authorProfile)
	row.innerHTML = `
		<div class="reply-header">
			<a href="${escapeHtml(formatSocialProfileHref(entityHash))}" class="reply-avatar-link">
				${renderAvatarHtml(entityHash, reply.authorProfile, 'reply-avatar')}
			</a>
			<div class="reply-header-text">
				<a href="${escapeHtml(formatSocialProfileHref(entityHash))}" class="link-btn author-name">${escapeHtml(authorLabel(entityHash, reply.authorProfile))}</a>
				<a href="${escapeHtml(formatSocialProfileHref(entityHash))}" class="author-handle">${escapeHtml(entityHandle(entityHash, reply.authorProfile))}</a>
				<span class="post-meta-sep">·</span>
				${formatTimeHtml(reply.post?.hlc?.wall || reply.hlc?.wall, 'post-meta reply-time', 'a', {
		href: formatSocialPostHref(entityHash, replyId),
	})}
			</div>
		</div>
		<div class="markdown-body reply-body">${bodyHtml}</div>
		${engagementBarHtml}
		<div class="replies nested-replies hidden" data-replies-for="${escapeHtml(actionKey)}"></div>
	`
	return row
}

/**
 * 渲染帖子回复面板与回复 composer。
 * @param {HTMLElement} panel 面板
 * @param {object[]} replies 回复列表
 * @returns {Promise<void>}
 */
export async function renderRepliesPanel(panel, replies) {
	const list = document.createElement('div')
	list.className = 'replies-list'
	if (!replies.length) {
		list.classList.add('is-empty')
		list.innerHTML = await renderTemplateAsHtmlString('replies_empty', {})
	}
	else
		for (const reply of replies)
			list.appendChild(await buildReplyRow(reply))

	panel.replaceChildren()
	if (panel.classList.contains('video-replies-panel')) {
		const header = await renderTemplate('video_replies_header', {})
		header.querySelector('[data-close-replies]')?.addEventListener('click', event => {
			event.stopPropagation()
			panel.classList.add('hidden')
			panel.closest('.video-slide')?.querySelector('[data-comment-ticker]')?.classList.remove('is-dimmed')
		})
		panel.appendChild(header)
	}
	panel.appendChild(list)
	panel.appendChild(await buildReplyComposer(panel.dataset.repliesFor || ''))
}
