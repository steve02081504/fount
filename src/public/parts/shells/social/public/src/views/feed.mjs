import { renderTemplate } from '../../../../../scripts/features/template.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { formatSocialSearchHref } from '../../shared/runUri.mjs'
import { entityHandle } from '../lib/display.mjs'
import { bindInfiniteScroll, disconnectInfiniteScroll, ensureScrollSentinel } from '../lib/infiniteScroll.mjs'
import { activateView } from '../viewChrome.mjs'
import { formatSocialProfileHref } from '/parts/shells:chat/shared/socialRunUri.mjs'

/**
 * 加载并渲染 Feed 页。
 * 更新 feed 搜索栏与加载更多的 UI 状态。
 * @param {object} appContext 应用上下文
 * @returns {void}
 */
export function updateFeedSearchChrome(appContext) {
	const clearButton = document.getElementById('feedSearchClearButton')
	const hasSearch = !!appContext.state.activeFeedSearchQuery
	clearButton?.classList.toggle('hidden', !hasSearch)
}

/**
 * 绑定 feed 无限滚动。
 * @param {object} appContext 应用上下文
 * @returns {void}
 */
export function bindFeedInfiniteScroll(appContext) {
	const list = document.getElementById('feedList')
	if (!list || appContext.state.activeFeedSearchQuery) {
		disconnectInfiniteScroll()
		return
	}
	const sentinel = ensureScrollSentinel(list, 'feedScrollSentinel')
	bindInfiniteScroll({
		sentinel,
		/**
		 *
		 */
		hasMore: () => !!appContext.state.feedCursor,
		/**
		 *
		 */
		onLoad: () => loadFeed(appContext, true),
	})
}

/**
 * 加载并渲染右栏推荐关注账户。
 * @param {object} appContext 应用上下文
 * @returns {Promise<void>}
 */
export async function loadSuggestedAccounts(appContext) {
	const aside = document.getElementById('asideSuggested')
	const list = document.getElementById('asideSuggestedList')
	if (!aside || !list) return
	const data = await appContext.socialApi('/explore?limit=5').catch(() => ({ accounts: [] }))
	const accounts = (data.accounts || []).filter(
		row => row.entityHash !== appContext.state.viewerEntityHash,
	)
	if (!accounts.length) {
		aside.classList.add('hidden')
		list.replaceChildren()
		return
	}
	aside.classList.remove('hidden')
	list.replaceChildren()
	for (const account of accounts) {
		const row = document.createElement('div')
		row.className = 'suggested-account'
		row.innerHTML = `
			${appContext.renderAvatarHtml(account.entityHash, { name: account.name })}
			<div class="suggested-account-info">
				<a href="${escapeHtml(formatSocialProfileHref(account.entityHash))}" class="suggested-account-name">${escapeHtml(account.name)}</a>
				<span class="suggested-account-handle">${escapeHtml(entityHandle(account.entityHash))}</span>
			</div>
			<button type="button" class="suggested-follow-btn" data-follow="${escapeHtml(account.entityHash)}">${escapeHtml(appContext.geti18n('social.actions.follow'))}</button>
		`
		list.appendChild(row)
	}
}

/**
 * 加载并渲染侧边栏热门话题标签。
 * @param {object} appContext 应用上下文
 * @returns {Promise<void>}
 */
export async function loadTrendingHashtags(appContext) {
	const aside = document.getElementById('feedTrending')
	if (!aside) return
	const data = await appContext.socialApi('/hashtags/trending?limit=12').catch(() => ({ tags: [] }))
	const tags = data.tags || []
	if (!tags.length) {
		aside.classList.add('hidden')
		aside.innerHTML = ''
		return
	}
	aside.classList.remove('hidden')
	aside.replaceChildren()
	aside.appendChild(await renderTemplate('trending_header', {}))
	const list = document.createElement('div')
	list.className = 'trending-tags'
	for (const row of tags) {
		const link = document.createElement('a')
		link.className = 'trending-tag link-btn'
		link.href = formatSocialSearchHref(row.tag)
		link.textContent = `#${row.tag}`
		link.title = appContext.geti18n('social.trending.postCount', { n: row.count })
		const count = document.createElement('span')
		count.className = 'trending-count'
		count.textContent = String(row.count)
		link.appendChild(count)
		list.appendChild(link)
	}
	aside.appendChild(list)
}

/**
 * 显示「有新帖」横幅（WS 增量，不重置 feed cursor）。
 * @param {object} appContext 应用上下文
 * @returns {void}
 */
export function showFeedNewPostsBanner(appContext) {
	const feedView = document.getElementById('feedView')
	if (!feedView || feedView.classList.contains('hidden')) return
	if (appContext.state.activeFeedSearchQuery) return
	if (document.getElementById('feedNewPostsBanner')) return
	const banner = document.createElement('button')
	banner.type = 'button'
	banner.id = 'feedNewPostsBanner'
	banner.className = 'feed-new-posts-banner btn btn-primary btn-sm'
	banner.textContent = appContext.geti18n('social.feed.newPosts')
	banner.addEventListener('click', () => {
		banner.remove()
		void loadFeed(appContext, false)
	})
	document.getElementById('feedList')?.before(banner)
}

let feedGeneration = 0

/**
 * 加载首页 feed（分页）。
 * @param {object} appContext 应用上下文
 * @param {boolean} [append=false] 追加
 * @returns {Promise<void>}
 */
export async function loadFeed(appContext, append = false) {
	if (appContext.state.activeFeedSearchQuery) return
	const gen = ++feedGeneration
	const cursorQuery = append && appContext.state.feedCursor
		? `&cursor=${encodeURIComponent(appContext.state.feedCursor)}`
		: ''
	const data = await appContext.socialApi(`/feed?limit=30${cursorQuery}`)
	if (feedGeneration !== gen) return
	const items = data.items || []
	const cards = await Promise.all(items.map(item => appContext.buildPostCard(item).catch(() => null)))
	if (feedGeneration !== gen) return
	appContext.state.feedCursor = data.nextCursor || null
	const list = document.getElementById('feedList')
	if (!list) return
	if (!append && !items.length) {
		const emptyElement = await renderTemplate('feed_empty', { emptyKey: 'social.empty.feed' })
		list.replaceChildren(emptyElement)
	}
	else if (!append) list.replaceChildren(...cards.filter(Boolean))
	else for (const card of cards)
		if (card) list.appendChild(card)

	bindFeedInfiniteScroll(appContext)
	void loadTrendingHashtags(appContext)
	void loadSuggestedAccounts(appContext)
}

/**
 * 执行 feed 关键词/话题搜索并渲染结果。
 * @param {object} appContext 应用上下文
 * @returns {Promise<void>}
 */
export async function runFeedSearch(appContext) {
	const input = document.getElementById('feedSearchInput')
	const q = input instanceof HTMLInputElement ? input.value.trim() : ''
	if (q.length < 2) {
		disconnectInfiniteScroll()
		const list = document.getElementById('feedList')
		const emptyElement = list ? await renderTemplate('feed_empty', { emptyKey: 'social.search.tooShort' }) : null
		if (list && emptyElement) list.replaceChildren(emptyElement)
		appContext.state.activeFeedSearchQuery = null
		updateFeedSearchChrome(appContext)
		return
	}
	appContext.state.activeFeedSearchQuery = q
	appContext.state.feedCursor = null
	disconnectInfiniteScroll()
	const data = await appContext.socialApi(`/search?q=${encodeURIComponent(q)}&limit=40`)
	if (appContext.state.activeFeedSearchQuery !== q) return
	const list = document.getElementById('feedList')
	if (!list) return
	const items = data.items || []
	const [hintElement, ...cardEls] = await Promise.all([
		renderTemplate('feed_search_hint', {}),
		...items.map(item => appContext.buildPostCard(item).catch(() => null)),
	])
	if (appContext.state.activeFeedSearchQuery !== q) return
	if (!items.length) {
		const emptyElement = await renderTemplate('feed_empty', { emptyKey: 'social.search.empty' })
		list.replaceChildren(hintElement, emptyElement)
	} else {
		const container = document.createElement('div')
		for (const card of cardEls) if (card) container.appendChild(card)
		list.replaceChildren(hintElement, container)
	}
	updateFeedSearchChrome(appContext)
}

/**
 * 清除搜索状态并恢复默认 feed。
 * @param {object} appContext 应用上下文
 * @returns {Promise<void>}
 */
export async function clearFeedSearch(appContext) {
	appContext.state.activeFeedSearchQuery = null
	disconnectInfiniteScroll()
	const input = document.getElementById('feedSearchInput')
	if (input instanceof HTMLInputElement) input.value = ''
	appContext.state.feedCursor = null
	await loadFeed(appContext, false)
	updateFeedSearchChrome(appContext)
}

/**
 * 切换到 feed 视图并执行指定搜索。
 * @param {object} appContext 应用上下文
 * @param {string} query 搜索词
 * @returns {Promise<void>}
 */
export async function openSearchView(appContext, query) {
	const q = String(query || '').trim()
	if (!q) return
	activateView('feed')
	const input = document.getElementById('feedSearchInput')
	if (input instanceof HTMLInputElement)
		input.value = q
	await runFeedSearch(appContext)
}
