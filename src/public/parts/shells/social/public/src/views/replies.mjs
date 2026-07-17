import { formatSocialPostHref, formatSocialProfileHref } from '../../shared/runUri.mjs'
import { formatActionKey } from '../lib/actionKey.mjs'
import { authorLabel, formatTime, renderAvatarHtml, renderMarkdown } from '../lib/display.mjs'
import { socialState } from '../state.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'

/**
 * @param {string} actionKey 回复目标 actionKey
 * @returns {HTMLElement} 回复 composer
 */
function buildReplyComposer(actionKey) {
	const composer = document.createElement('div')
	composer.className = 'reply-composer'
	const avatarHtml = socialState.viewerEntityHash
		? renderAvatarHtml(socialState.viewerEntityHash, {
			name: socialState.viewerDisplayName,
		}, 'reply-composer-avatar')
		: ''
	composer.innerHTML = `
		${avatarHtml ? `<div class="reply-composer-avatar-slot" aria-hidden="true">${avatarHtml}</div>` : ''}
		<div class="reply-composer-body">
			<textarea rows="1" placeholder="${escapeHtml(geti18n('social.replies.placeholder'))}"></textarea>
			<div class="reply-composer-actions">
				<button type="button" class="reply-composer-submit" data-submit-reply="${escapeHtml(actionKey)}">${escapeHtml(geti18n('social.replies.submit'))}</button>
			</div>
		</div>
	`
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
		? `<em>${geti18n('social.feed.decryptFailed')}</em>`
		: await renderMarkdown(text, entityHash)
	const likedClass = reply.viewerLiked ? ' liked' : ''
	const dislikedClass = reply.viewerDisliked ? ' disliked' : ''
	const likeLabel = reply.viewerLiked
		? geti18n('social.actions.unlike')
		: geti18n('social.actions.like')
	const dislikeLabel = reply.viewerDisliked
		? geti18n('social.actions.undislike')
		: geti18n('social.actions.dislike')
	row.innerHTML = `
		<div class="reply-header">
			<a href="${escapeHtml(formatSocialProfileHref(entityHash))}" class="reply-avatar-link">
				${renderAvatarHtml(entityHash, reply.authorProfile, 'reply-avatar')}
			</a>
			<div class="reply-header-text">
				<a href="${escapeHtml(formatSocialProfileHref(entityHash))}" class="link-btn author-name">${escapeHtml(authorLabel(entityHash, reply.authorProfile))}</a>
				<a href="${escapeHtml(formatSocialPostHref(entityHash, replyId))}" class="post-meta reply-time">${escapeHtml(formatTime(reply.post?.hlc?.wall || reply.hlc?.wall))}</a>
			</div>
		</div>
		<div class="markdown-body reply-body">${bodyHtml}</div>
		<div class="reply-actions">
			<button type="button" class="action-btn action-btn-reply replies-btn" data-replies="${escapeHtml(actionKey)}" aria-label="${escapeHtml(geti18n('social.actions.replies'))}">
				<span class="s-ic s-ic-reply" aria-hidden="true"></span>
				<span class="action-count">${reply.replyCount || 0}</span>
			</button>
			<button type="button" class="action-btn action-btn-like like-btn${likedClass}" data-like="${escapeHtml(actionKey)}" data-liked="${reply.viewerLiked ? '1' : '0'}" aria-label="${escapeHtml(likeLabel)}">
				<span class="s-ic s-ic-like" aria-hidden="true"></span>
				<span class="action-count">${reply.likeCount || 0}</span>
			</button>
			<button type="button" class="action-btn action-btn-dislike dislike-btn${dislikedClass}" data-dislike="${escapeHtml(actionKey)}" data-disliked="${reply.viewerDisliked ? '1' : '0'}" aria-label="${escapeHtml(dislikeLabel)}">
				<span class="s-ic s-ic-dislike" aria-hidden="true"></span>
				<span class="action-count">${reply.dislikeCount || 0}</span>
			</button>
			<button type="button" class="action-btn action-btn-share" data-share="${escapeHtml(actionKey)}" aria-label="${escapeHtml(geti18n('social.actions.share'))}">
				<span class="s-ic s-ic-share" aria-hidden="true"></span>
			</button>
		</div>
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
		list.innerHTML = `
			<div class="replies-empty">
				<span class="s-ic s-ic-reply replies-empty-icon" aria-hidden="true"></span>
				<p class="replies-empty-title">${escapeHtml(geti18n('social.replies.empty'))}</p>
				<p class="replies-empty-hint">${escapeHtml(geti18n('social.replies.emptyHint'))}</p>
			</div>
		`
	}
	else
		for (const reply of replies)
			list.appendChild(await buildReplyRow(reply))

	panel.replaceChildren()
	if (panel.classList.contains('video-replies-panel')) {
		const header = document.createElement('div')
		header.className = 'video-replies-header'
		header.innerHTML = `
			<span class="video-replies-title">${escapeHtml(geti18n('social.actions.replies'))}</span>
			<button type="button" class="video-replies-close" data-close-replies aria-label="${escapeHtml(geti18n('social.video.closeReplies'))}">
				<span class="s-ic s-ic-close" aria-hidden="true"></span>
			</button>
		`
		header.querySelector('[data-close-replies]')?.addEventListener('click', event => {
			event.stopPropagation()
			panel.classList.add('hidden')
			panel.closest('.video-slide')?.querySelector('[data-comment-ticker]')?.classList.remove('is-dimmed')
		})
		panel.appendChild(header)
	}
	panel.appendChild(list)
	panel.appendChild(buildReplyComposer(panel.dataset.repliesFor || ''))
}
