import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { entityHandle } from '../lib/display.mjs'
import { formatSocialProfileHref } from '/parts/shells:chat/src/lib/socialRunUri.mjs'

/**
 * 加载并渲染探索页账户与帖子推荐。
 * @param {object} appContext 应用上下文
 * @returns {Promise<void>}
 */
export async function loadExplore(appContext) {
	const mediaQuery = appContext.state.exploreMediaOnly ? '&mediaOnly=true' : ''
	const [accounts, posts] = await Promise.all([
		appContext.socialApi('/explore?limit=20'),
		appContext.socialApi(`/explore/posts?limit=20${mediaQuery}`),
	])
	const container = document.getElementById('exploreView')
	const header = container.querySelector('.view-header')
	container.replaceChildren()
	if (header) container.appendChild(header)

	const toolbar = document.createElement('div')
	toolbar.className = 'explore-toolbar'
	toolbar.innerHTML = `
		<label class="explore-media-toggle">
			<input type="checkbox" id="exploreMediaOnly" ${appContext.state.exploreMediaOnly ? 'checked' : ''} />
			<span>${escapeHtml(appContext.geti18n('social.explore.mediaOnly'))}</span>
		</label>
	`
	container.appendChild(toolbar)

	document.getElementById('exploreMediaOnly')?.addEventListener('change', event => {
		appContext.state.exploreMediaOnly = event.target instanceof HTMLInputElement && event.target.checked
		void loadExplore(appContext)
	})

	const accountsTitle = document.createElement('h3')
	accountsTitle.className = 'section-title'
	accountsTitle.style.padding = '0 1rem'
	accountsTitle.textContent = appContext.geti18n('social.explore.accounts')
	container.appendChild(accountsTitle)

	for (const account of accounts.accounts || []) {
		const row = document.createElement('div')
		row.className = 'explore-account'
		row.innerHTML = `
			<div class="post-header-row">
				${appContext.renderAvatarHtml(account.entityHash, { name: account.name })}
				<div class="suggested-account-info">
					<a href="${escapeHtml(formatSocialProfileHref(account.entityHash))}" class="suggested-account-name">${escapeHtml(account.name)}</a>
					<span class="suggested-account-handle">${escapeHtml(entityHandle(account.entityHash))}</span>
					${account.exploreBlurb ? `<p class="profile-bio">${escapeHtml(account.exploreBlurb)}</p>` : ''}
					<button type="button" class="suggested-follow-btn" data-follow="${escapeHtml(account.entityHash)}">${escapeHtml(appContext.geti18n('social.actions.follow'))}</button>
				</div>
			</div>
		`
		container.appendChild(row)
	}

	const postsTitle = document.createElement('h3')
	postsTitle.className = 'section-title'
	postsTitle.style.padding = '0 1rem'
	postsTitle.textContent = appContext.geti18n('social.explore.posts')
	container.appendChild(postsTitle)

	const postList = document.createElement('div')
	postList.className = 'explore-post-list'
	container.appendChild(postList)

	if (!(posts.posts || []).length)
		postList.innerHTML = `<div class="empty">${escapeHtml(appContext.geti18n('social.empty.explorePosts'))}</div>`

	for (const post of posts.posts || []) {
		const row = document.createElement('article')
		row.className = 'explore-post-card'
		const href = formatSocialProfileHref(post.entityHash, post.postId)
		const snippet = post.textSnippet || (post.mediaThumbs?.length
			? appContext.geti18n('social.profile.mediaOnly')
			: '')
		row.innerHTML = `
			<p class="explore-snippet">${escapeHtml(snippet)}</p>
			<footer class="explore-post-meta">
				<a href="${escapeHtml(href)}" class="author-name">${escapeHtml(appContext.authorLabel(post.entityHash))}</a>
				<span class="post-meta">${escapeHtml(appContext.formatTime(post.hlc?.wall))}</span>
			</footer>
		`
		postList.appendChild(row)
	}
}
