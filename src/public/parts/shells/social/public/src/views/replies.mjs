import { formatSocialProfileHref } from '../../shared/runUri.mjs'
import { authorLabel, formatTime, renderMarkdown } from '../lib/display.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'

/**
 * 渲染帖子回复面板与回复 composer。
 * @param {HTMLElement} panel 面板
 * @param {object[]} replies 回复列表
 * @returns {Promise<void>}
 */
export async function renderRepliesPanel(panel, replies) {
	const list = document.createElement('div')
	list.className = 'replies-list'
	if (!replies.length)
		list.innerHTML = `<em>${geti18n('social.replies.empty')}</em>`
	else
		for (const reply of replies) {
			const row = document.createElement('div')
			row.className = 'reply'
			const text = reply.post?.content?.text || ''
			const bodyHtml = reply.post?.decryptView?.failed
				? `<em>${geti18n('social.feed.decryptFailed')}</em>`
				: await renderMarkdown(text, reply.entityHash)
			row.innerHTML = `
				<div class="reply-header">
					<a href="${formatSocialProfileHref(reply.entityHash)}" class="link-btn">${authorLabel(reply.entityHash)}</a>
					<span class="post-meta">${formatTime(reply.post?.hlc?.wall)}</span>
				</div>
				<div class="markdown-body">${bodyHtml}</div>
			`
			list.appendChild(row)
		}

	panel.replaceChildren()
	if (panel.classList.contains('video-replies-panel')) {
		const header = document.createElement('div')
		header.className = 'video-replies-header'
		header.innerHTML = `
			<span class="video-replies-title">${geti18n('social.actions.replies')}</span>
			<button type="button" class="video-replies-close" data-close-replies aria-label="${geti18n('social.video.closeReplies')}">
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
	const composer = document.createElement('div')
	composer.className = 'reply-composer'
	composer.innerHTML = `
		<textarea rows="2" placeholder="${geti18n('social.replies.placeholder')}"></textarea>
		<button type="button" data-submit-reply="${panel.dataset.repliesFor}">${geti18n('social.replies.submit')}</button>
	`
	panel.appendChild(composer)
}
