import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { mediaRefUrl } from '/parts/shells:chat/shared/evfsMedia.mjs'
import { formatSocialPostHref, formatSocialProfileHref } from '../../shared/runUri.mjs'
import { socialApi } from '../lib/apiClient.mjs'
import { authorLabel, entityHandle, formatTime, renderAvatarHtml } from '../lib/display.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'
import { socialState } from '../state.mjs'

let exploreToolbarBound = false

/**
 * 绑定探索页工具栏（幂等）。
 * @returns {void}
 */
function bindExploreToolbar() {
	if (exploreToolbarBound) return
	const input = document.getElementById('exploreMediaOnly')
	if (!(input instanceof HTMLInputElement)) return
	exploreToolbarBound = true
	input.addEventListener('change', () => {
		socialState.exploreMediaOnly = input.checked
		void loadExplore()
	})
}

/**
 * 探索分区空态（图标 + 文案，两区共用）。
 * @param {string} iconClass 图标 class（如 s-ic-user）
 * @param {string} i18nKey 文案 key
 * @returns {string} HTML
 */
function renderExploreEmpty(iconClass, i18nKey) {
	return `
		<div class="explore-empty">
			<span class="s-ic ${iconClass} explore-empty-icon" aria-hidden="true"></span>
			<p>${escapeHtml(geti18n(i18nKey))}</p>
		</div>
	`
}

/**
 * 渲染探索帖媒体缩略条。
 * @param {object[]} mediaThumbs 媒体引用
 * @returns {string} HTML
 */
function renderExploreThumbs(mediaThumbs) {
	if (!mediaThumbs?.length) return ''
	const cells = []
	for (const ref of mediaThumbs.slice(0, 4)) {
		let url = ''
		try { url = mediaRefUrl(ref) }
		catch { continue }
		const mimeType = ref.mimeType || ''
		const isVideo = (ref.kind || '').startsWith('video') || mimeType.startsWith('video/')
		cells.push(isVideo
			? '<div class="explore-thumb explore-thumb-video" aria-hidden="true"><span class="s-ic s-ic-media"></span></div>'
			: `<div class="explore-thumb"><img src="${escapeHtml(url)}" alt="" loading="lazy" /></div>`)
	}
	if (!cells.length) return ''
	return `<div class="explore-thumbs" data-count="${cells.length}">${cells.join('')}</div>`
}

/**
 * 加载并渲染探索页账户与帖子推荐。
 * @returns {Promise<void>}
 */
export async function loadExplore() {
	bindExploreToolbar()
	const mediaInput = document.getElementById('exploreMediaOnly')
	if (mediaInput instanceof HTMLInputElement)
		mediaInput.checked = socialState.exploreMediaOnly

	const mediaQuery = socialState.exploreMediaOnly ? '&mediaOnly=true' : ''
	const [accounts, posts] = await Promise.all([
		socialApi('/explore?limit=20'),
		socialApi(`/explore/posts?limit=20${mediaQuery}`),
	])

	const accountList = document.getElementById('exploreAccountList')
	const postList = document.getElementById('explorePostList')
	if (!accountList || !postList) return

	const accountRows = (accounts.accounts || []).filter(
		row => row.entityHash !== socialState.viewerEntityHash,
	)
	accountList.replaceChildren()
	if (!accountRows.length)
		accountList.innerHTML = renderExploreEmpty('s-ic-user', 'social.empty.exploreAccounts')
	else
		for (const account of accountRows) {
			const row = document.createElement('article')
			row.className = 'explore-account'
			const profileHref = formatSocialProfileHref(account.entityHash)
			row.innerHTML = `
				<a href="${escapeHtml(profileHref)}" class="explore-account-avatar-link">
					${renderAvatarHtml(account.entityHash, { name: account.name, avatar: account.avatarUrl }, 'explore-account-avatar')}
				</a>
				<div class="explore-account-body">
					<a href="${escapeHtml(profileHref)}" class="suggested-account-name">${escapeHtml(account.name)}</a>
					<span class="suggested-account-handle">${escapeHtml(entityHandle(account.entityHash, account))}</span>
					${account.bio ? `<p class="explore-account-bio">${escapeHtml(account.bio)}</p>` : ''}
				</div>
				<button type="button" class="suggested-follow-btn" data-follow="${escapeHtml(account.entityHash)}">${escapeHtml(geti18n('social.actions.follow'))}</button>
			`
			accountList.appendChild(row)
		}

	const postRows = posts.posts || []
	postList.replaceChildren()
	if (!postRows.length) {
		postList.innerHTML = renderExploreEmpty('s-ic-explore', 'social.empty.explorePosts')
		return
	}

	for (const post of postRows) {
		const row = document.createElement('article')
		row.className = 'explore-post-card'
		const href = formatSocialPostHref(post.entityHash, post.postId)
		const authorHref = formatSocialProfileHref(post.entityHash)
		const snippet = post.textSnippet || (post.mediaThumbs?.length
			? geti18n('social.profile.mediaOnly')
			: '')
		const name = authorLabel(post.entityHash, post.authorProfile)
		const handle = entityHandle(post.entityHash, post.authorProfile)
		row.innerHTML = `
			<header class="explore-post-header">
				<a href="${escapeHtml(authorHref)}" class="explore-post-avatar-link">
					${renderAvatarHtml(post.entityHash, post.authorProfile || { name }, 'explore-post-avatar')}
				</a>
				<div class="explore-post-author">
					<a href="${escapeHtml(authorHref)}" class="author-name">${escapeHtml(name)}</a>
					<a href="${escapeHtml(authorHref)}" class="author-handle">${escapeHtml(handle)}</a>
					<span class="post-meta">${escapeHtml(formatTime(post.hlc?.wall))}</span>
				</div>
			</header>
			<a href="${escapeHtml(href)}" class="explore-post-body">
				${snippet ? `<p class="explore-snippet">${escapeHtml(snippet)}</p>` : ''}
				${renderExploreThumbs(post.mediaThumbs)}
			</a>
		`
		postList.appendChild(row)
	}

	const exploreSuggestedHost = document.getElementById('exploreSuggested')
	const exploreSuggestedList = document.getElementById('exploreSuggestedList')
	if (exploreSuggestedHost && exploreSuggestedList) {
		const suggested = accountRows.slice(0, 5)
		if (!suggested.length) {
			exploreSuggestedHost.classList.add('hidden')
			exploreSuggestedList.replaceChildren()
		}
		else {
			exploreSuggestedHost.classList.remove('hidden')
			exploreSuggestedList.replaceChildren()
			for (const account of suggested) {
				const row = document.createElement('div')
				row.className = 'suggested-account'
				row.innerHTML = `
					${renderAvatarHtml(account.entityHash, { name: account.name })}
					<div class="suggested-account-info">
						<a href="${escapeHtml(formatSocialProfileHref(account.entityHash))}" class="suggested-account-name">${escapeHtml(account.name)}</a>
						<span class="suggested-account-handle">${escapeHtml(entityHandle(account.entityHash, account))}</span>
					</div>
					<button type="button" class="suggested-follow-btn" data-follow="${escapeHtml(account.entityHash)}">${escapeHtml(geti18n('social.actions.follow'))}</button>
				`
				exploreSuggestedList.appendChild(row)
			}
		}
	}

	const { loadTrendingHashtags } = await import('./feed.mjs')
	await loadTrendingHashtags('local', 'exploreTrending')
}
