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

	panel.innerHTML = ''
	panel.appendChild(list)
	const composer = document.createElement('div')
	composer.className = 'reply-composer'
	composer.innerHTML = `
		<textarea rows="2" placeholder="${geti18n('social.replies.placeholder')}"></textarea>
		<button type="button" data-submit-reply="${panel.dataset.repliesFor}">${geti18n('social.replies.submit')}</button>
	`
	panel.appendChild(composer)
}
