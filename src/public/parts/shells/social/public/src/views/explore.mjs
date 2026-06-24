import { formatSocialProfileHref } from '../lib/runUri.mjs'

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
	container.innerHTML = `
		<div class="explore-toolbar">
			<label class="explore-media-toggle">
				<input type="checkbox" id="exploreMediaOnly" ${appContext.state.exploreMediaOnly ? 'checked' : ''} />
				<span>${appContext.geti18n('social.explore.mediaOnly')}</span>
			</label>
		</div>
		<h2 class="section-title">${appContext.geti18n('social.explore.accounts')}</h2>
	`
	document.getElementById('exploreMediaOnly')?.addEventListener('change', event => {
		appContext.state.exploreMediaOnly = event.target instanceof HTMLInputElement && event.target.checked
		void loadExplore(appContext)
	})
	for (const account of accounts.accounts || []) {
		const row = document.createElement('div')
		row.className = 'card explore-account'
		row.innerHTML = `
			<div class="post-header-row">
				${appContext.renderAvatarHtml(account.entityHash, { name: account.name })}
				<div>
					<strong><a href="${formatSocialProfileHref(account.entityHash)}" class="link-btn">${account.name}</a></strong>
					<p>${account.exploreBlurb || ''}</p>
					<button type="button" data-follow="${account.entityHash}">${appContext.geti18n('social.actions.follow')}</button>
				</div>
			</div>
		`
		container.appendChild(row)
	}
	const postsTitle = document.createElement('h2')
	postsTitle.className = 'section-title'
	postsTitle.textContent = appContext.geti18n('social.explore.posts')
	container.appendChild(postsTitle)
	const postList = document.createElement('div')
	postList.className = 'explore-post-list'
	container.appendChild(postList)
	if (!(posts.posts || []).length)
		postList.innerHTML = `<div class="empty">${appContext.geti18n('social.empty.explorePosts')}</div>`
	for (const post of posts.posts || []) {
		const row = document.createElement('article')
		row.className = 'card explore-post-card'
		const href = formatSocialProfileHref(post.entityHash, post.postId)
		const snippet = post.textSnippet || (post.mediaThumbs?.length
			? appContext.geti18n('social.profile.mediaOnly')
			: '')
		row.innerHTML = `
			<p class="explore-snippet">${snippet}</p>
			<footer class="explore-post-meta">
				<a href="${href}" class="link-btn">${appContext.authorLabel(post.entityHash)}</a>
				<span class="post-meta">${appContext.formatTime(post.hlc?.wall)}</span>
			</footer>
		`
		postList.appendChild(row)
	}
}
