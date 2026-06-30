import { formatSocialProfileHref } from '/parts/shells:chat/src/lib/socialRunUri.mjs'

/**
 * 渲染帖子回复面板与回复 composer。
 * @param {object} appContext 应用上下文
 * @param {HTMLElement} panel 面板
 * @param {object[]} replies 回复列表
 * @returns {Promise<void>}
 */
export async function renderRepliesPanel(appContext, panel, replies) {
	const list = document.createElement('div')
	list.className = 'replies-list'
	if (!replies.length)
		list.innerHTML = `<em>${appContext.geti18n('social.replies.empty')}</em>`
	else
		for (const reply of replies) {
			const row = document.createElement('div')
			row.className = 'reply'
			const text = reply.post?.content?.text || ''
			const bodyHtml = reply.post?.content?.protected
				? `<em>${appContext.geti18n('social.profile.protectedPost')}</em>`
				: await appContext.renderMarkdown(text, reply.entityHash)
			row.innerHTML = `
				<div class="reply-header">
					<a href="${formatSocialProfileHref(reply.entityHash)}" class="link-btn">${appContext.authorLabel(reply.entityHash)}</a>
					<span class="post-meta">${appContext.formatTime(reply.post?.hlc?.wall)}</span>
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
		<textarea rows="2" placeholder="${appContext.geti18n('social.replies.placeholder')}"></textarea>
		<button type="button" data-submit-reply="${panel.dataset.repliesFor}">${appContext.geti18n('social.replies.submit')}</button>
	`
	panel.appendChild(composer)
}
