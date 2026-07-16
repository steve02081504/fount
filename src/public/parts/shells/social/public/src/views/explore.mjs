import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { formatSocialProfileHref } from '../../shared/runUri.mjs'
import { socialApi } from '../lib/apiClient.mjs'
import { authorLabel, entityHandle, formatTime, renderAvatarHtml } from '../lib/display.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'
import { socialState } from '../state.mjs'

/**
 * 加载并渲染探索页账户与帖子推荐。
 * @returns {Promise<void>}
 */
export async function loadExplore() {
	const mediaQuery = socialState.exploreMediaOnly ? '&mediaOnly=true' : ''
	const [accounts, posts] = await Promise.all([
		socialApi('/explore?limit=20'),
		socialApi(`/explore/posts?limit=20${mediaQuery}`),
	])
	const container = document.getElementById('exploreView')
	const header = container.querySelector('.view-header')
	container.replaceChildren()
	if (header) container.appendChild(header)

	const toolbar = document.createElement('div')
	toolbar.className = 'explore-toolbar'
	toolbar.innerHTML = `
		<label class="explore-media-toggle">
			<input type="checkbox" id="exploreMediaOnly" ${socialState.exploreMediaOnly ? 'checked' : ''} />
			<span>${escapeHtml(geti18n('social.explore.mediaOnly'))}</span>
		</label>
	`
	container.appendChild(toolbar)

	document.getElementById('exploreMediaOnly')?.addEventListener('change', event => {
		socialState.exploreMediaOnly = event.target instanceof HTMLInputElement && event.target.checked
		void loadExplore()
	})

	const accountsTitle = document.createElement('h3')
	accountsTitle.className = 'section-title'
	accountsTitle.style.padding = '0 1rem'
	accountsTitle.textContent = geti18n('social.explore.accounts')
	container.appendChild(accountsTitle)

	for (const account of accounts.accounts || []) {
		const row = document.createElement('div')
		row.className = 'explore-account'
		row.innerHTML = `
			<div class="post-header-row">
				${renderAvatarHtml(account.entityHash, { name: account.name })}
				<div class="suggested-account-info">
					<a href="${escapeHtml(formatSocialProfileHref(account.entityHash))}" class="suggested-account-name">${escapeHtml(account.name)}</a>
					<span class="suggested-account-handle">${escapeHtml(entityHandle(account.entityHash))}</span>
					${account.exploreBlurb ? `<p class="profile-bio">${escapeHtml(account.exploreBlurb)}</p>` : ''}
					<button type="button" class="suggested-follow-btn" data-follow="${escapeHtml(account.entityHash)}">${escapeHtml(geti18n('social.actions.follow'))}</button>
				</div>
			</div>
		`
		container.appendChild(row)
	}

	const postsTitle = document.createElement('h3')
	postsTitle.className = 'section-title'
	postsTitle.style.padding = '0 1rem'
	postsTitle.textContent = geti18n('social.explore.posts')
	container.appendChild(postsTitle)

	const postList = document.createElement('div')
	postList.className = 'explore-post-list'
	container.appendChild(postList)

	if (!(posts.posts || []).length)
		postList.innerHTML = `<div class="empty">${escapeHtml(geti18n('social.empty.explorePosts'))}</div>`

	for (const post of posts.posts || []) {
		const row = document.createElement('article')
		row.className = 'explore-post-card'
		const href = formatSocialProfileHref(post.entityHash, post.postId)
		const snippet = post.textSnippet || (post.mediaThumbs?.length
			? geti18n('social.profile.mediaOnly')
			: '')
		row.innerHTML = `
			<p class="explore-snippet">${escapeHtml(snippet)}</p>
			<footer class="explore-post-meta">
				<a href="${escapeHtml(href)}" class="author-name">${escapeHtml(authorLabel(post.entityHash))}</a>
				<span class="post-meta">${escapeHtml(formatTime(post.hlc?.wall))}</span>
			</footer>
		`
		postList.appendChild(row)
	}
}
