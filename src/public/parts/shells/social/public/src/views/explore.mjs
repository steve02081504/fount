import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { mediaRefUrl } from '/parts/shells:chat/shared/evfsMedia.mjs'
import { formatSocialPostHref, formatSocialProfileHref } from '../../shared/runUri.mjs'
import { getExplorePosts } from '../endpoints/explore.mjs'
import { getExploreAccounts } from '../endpoints/feed.mjs'
import { authorLabel, entityHandle, formatTimeHtml, mountMarkdown, rememberEntityHandle, renderAvatarHtml } from '../lib/display.mjs'
import { mountEmptyState } from '../lib/emptyState.mjs'
import { renderSuggestedAccountRows } from '../lib/suggestedAccounts.mjs'
import { renderTemplate } from '/scripts/features/template.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { state } from '../state.mjs'

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
		state.exploreMediaOnly = input.checked
		void loadExplore()
	})
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
			? '<div class="explore-thumb explore-thumb-video" aria-hidden="true"><span class="icon icon-media"></span></div>'
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
		mediaInput.checked = state.exploreMediaOnly

	let accounts
	let posts
	try {
		;[accounts, posts] = await Promise.all([
			getExploreAccounts(20),
			getExplorePosts({ limit: 20, mediaOnly: state.exploreMediaOnly }),
		])
	}
	catch (error) {
		handleError('social.explore.loadFailed', {}, error)
		return
	}

	const accountList = document.getElementById('exploreAccountList')
	const postList = document.getElementById('explorePostList')
	if (!accountList || !postList) return

	const accountRows = (accounts.accounts || []).filter(
		row => row.entityHash !== state.viewerEntityHash,
	)
	accountList.replaceChildren()
	if (!accountRows.length)
		await mountEmptyState(accountList, {
			titleKey: 'social.empty.exploreAccounts',
			iconClass: 'icon-user',
			modClass: ' empty-state--explore',
		})
	else
		for (const account of accountRows) {
			const profileHref = escapeHtml(formatSocialProfileHref(account.entityHash))
			const row = await renderTemplate('explore_account', {
				profileHref,
				entityHash: escapeHtml(account.entityHash),
				name: escapeHtml(account.name),
				handle: escapeHtml(entityHandle(account.entityHash, account)),
				avatarHtml: renderAvatarHtml(account.entityHash, { name: account.name, avatar: account.avatarUrl }, 'explore-account-avatar'),
				bioHtml: account.bio ? '<div class="explore-account-bio" data-explore-bio user-content></div>' : '',
			})
			const bioHost = row.querySelector('[data-explore-bio]')
			if (bioHost instanceof HTMLElement && account.bio)
				await mountMarkdown(bioHost, account.bio, account.entityHash)
			accountList.appendChild(row)
		}

	const postRows = posts.posts || []
	postList.replaceChildren()
	if (!postRows.length) {
		await mountEmptyState(postList, {
			titleKey: 'social.empty.explorePosts',
			iconClass: 'icon-explore',
			modClass: ' empty-state--explore',
		})
		return
	}

	for (const post of postRows) {
		const href = formatSocialPostHref(post.entityHash, post.postId)
		const authorHref = escapeHtml(formatSocialProfileHref(post.entityHash))
		const name = authorLabel(post.entityHash, post.authorProfile)
		const handle = entityHandle(post.entityHash, post.authorProfile)
		rememberEntityHandle(post.entityHash, post.authorProfile)
		const timeHtml = formatTimeHtml(post.hlc?.wall)
		const snippetHtml = post.textSnippet
			? '<div class="explore-snippet" data-explore-snippet user-content></div>'
			: post.mediaThumbs?.length
				? '<p class="explore-snippet" data-i18n="social.profile.mediaOnly"></p>'
				: ''
		const row = await renderTemplate('explore_post', {
			href: escapeHtml(href),
			authorHref,
			name: escapeHtml(name),
			handle: escapeHtml(handle),
			timeHtml,
			avatarHtml: renderAvatarHtml(post.entityHash, post.authorProfile || { name }, 'explore-post-avatar'),
			snippetHtml,
			thumbsHtml: renderExploreThumbs(post.mediaThumbs),
		})
		const snippetHost = row.querySelector('[data-explore-snippet]')
		if (snippetHost instanceof HTMLElement && post.textSnippet)
			await mountMarkdown(snippetHost, post.textSnippet, post.entityHash)
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
			await renderSuggestedAccountRows(exploreSuggestedList, suggested)
		}
	}

	const { loadTrendingHashtags } = await import('./feed.mjs')
	await loadTrendingHashtags('exploreTrending')
}
