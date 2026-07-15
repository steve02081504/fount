import { renderTemplate } from '../../../../../scripts/features/template.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { formatSocialTopicHref } from '../../shared/runUri.mjs'
import { bindDwellTracker, sendDwellBeacon } from '../dwellTracker.mjs'
import { entityHandle } from '../lib/display.mjs'
import { bindInfiniteScroll, disconnectInfiniteScroll, ensureScrollSentinel } from '/scripts/infiniteScroll.mjs'
import { activateView } from '../viewChrome.mjs'
import { formatSocialProfileHref } from '/parts/shells:chat/shared/socialRunUri.mjs'

/** @type {(() => void) | null} */
let unbindDwell = null

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
		rootMargin: '480px 0px',
		/** @returns {boolean} 有下一页或可循环重放 */
		hasMore: () => !!appContext.state.feedCursor
			|| !!appContext.state.feedShownItems?.length,
		/** @returns {Promise<void>} 追加下一页或循环重放 */
		onLoad: () => loadFeed(appContext, true),
	})
}

/**
 * 后台预取下一页（结果缓存在 state.feedPrefetch）。
 * @param {object} appContext 应用上下文
 * @returns {void}
 */
function scheduleFeedPrefetch(appContext) {
	const cursor = appContext.state.feedCursor
	if (!cursor || appContext.state.activeFeedSearchQuery) return
	if (appContext.state.feedPrefetch?.cursor === cursor) return
	if (appContext.state.feedPrefetchInFlight) return
	const gen = feedGeneration
	appContext.state.feedPrefetchInFlight = (async () => {
		const data = await appContext.socialApi(
			`/feed?limit=30${feedRankingQuery(appContext)}&cursor=${encodeURIComponent(cursor)}`,
		).catch(() => null)
		if (feedGeneration !== gen) return
		if (!data || appContext.state.feedCursor !== cursor) return
		appContext.state.feedPrefetch = {
			cursor,
			items: data.items || [],
			nextCursor: data.nextCursor || null,
		}
	})().finally(() => {
		appContext.state.feedPrefetchInFlight = null
	})
}

/**
 * 循环重放已展示条目。
 * @param {object} appContext 应用上下文
 * @returns {Promise<void>}
 */
async function replayFeedItems(appContext) {
	const items = appContext.state.feedShownItems
	if (!items?.length) return
	const list = document.getElementById('feedList')
	if (!list) return
	const divider = document.createElement('div')
	divider.className = 'feed-replay-divider text-center text-sm opacity-50 py-3'
	divider.dataset.i18n = 'social.feed.replayDivider'
	divider.textContent = appContext.geti18n('social.feed.replayDivider')
	list.appendChild(divider)
	const cards = await Promise.all(items.map(item => appContext.buildPostCard(item).catch(() => null)))
	for (const card of cards) if (card) list.appendChild(card)
	bindFeedInfiniteScroll(appContext)
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
 * @param {'local' | 'nearby'} [scope='local'] 范围
 * @returns {Promise<void>}
 */
export async function loadTrendingHashtags(appContext, scope = 'local') {
	const aside = document.getElementById('feedTrending')
	if (!aside) return
	const currentScope = scope === 'nearby' ? 'nearby' : 'local'
	aside.dataset.trendingScope = currentScope
	const data = await appContext.socialApi(`/hashtags/trending?limit=12&scope=${currentScope}`).catch(() => ({ tags: [] }))
	const tags = data.tags || []
	aside.classList.remove('hidden')
	aside.replaceChildren()
	aside.appendChild(await renderTemplate('trending_header', {
		localActive: currentScope === 'local' ? 'active' : '',
		nearbyActive: currentScope === 'nearby' ? 'active' : '',
		localLabel: appContext.geti18n('social.trending.scopeLocal'),
		nearbyLabel: appContext.geti18n('social.trending.scopeNearby'),
	}))
	const list = document.createElement('div')
	list.className = 'trending-tags'
	if (!tags.length)
		list.innerHTML = `<p class="empty-hint">${appContext.geti18n('social.trending.empty')}</p>`
	else
		for (const row of tags) {
			const link = document.createElement('a')
			link.className = 'trending-tag link-btn'
			link.href = formatSocialTopicHref(row.tag)
			link.textContent = `#${row.tag}`
			link.title = appContext.geti18n('social.trending.postCount', { n: row.count })
			const count = document.createElement('span')
			count.className = 'trending-count'
			count.textContent = String(row.count)
			link.appendChild(count)
			list.appendChild(link)
		}

	aside.appendChild(list)
	aside.querySelectorAll('[data-trending-scope]').forEach(btn => {
		btn.addEventListener('click', () => {
			const next = btn.getAttribute('data-trending-scope') === 'nearby' ? 'nearby' : 'local'
			void loadTrendingHashtags(appContext, next)
		})
	})
}

/**
 * 在 feed 顶部插入单条帖子卡片（WS 真增量）。
 * @param {object} appContext 应用上下文
 * @param {object} item feed 条目
 * @returns {Promise<boolean>} 是否成功插入
 */
export async function prependFeedItem(appContext, item) {
	if (appContext.state.activeFeedSearchQuery) return false
	if (appContext.state.feedCursor) return false
	const feedView = document.getElementById('feedView')
	if (!feedView || feedView.classList.contains('hidden')) return false
	const list = document.getElementById('feedList')
	if (!list) return false
	document.getElementById('feedNewPostsBanner')?.remove()
	const card = await appContext.buildPostCard(item).catch(() => null)
	if (!card) return false
	const empty = list.querySelector('.feed-empty')
	if (empty) list.replaceChildren(card)
	else list.prepend(card)
	return true
}

/**
 * @param {object} appContext 应用上下文
 * @returns {string} feed ranking query 片段
 */
function feedRankingQuery(appContext) {
	return appContext.state.feedRanking === 'for_you' ? '&ranking=for_you' : ''
}

/**
 * 更新 feed 排序 tab 高亮。
 * @param {object} appContext 应用上下文
 * @returns {void}
 */
export function updateFeedRankingTabs(appContext) {
	for (const tab of document.querySelectorAll('[data-feed-ranking]')) {
		if (!(tab instanceof HTMLElement)) continue
		tab.classList.toggle('active', tab.dataset.feedRanking === appContext.state.feedRanking)
	}
}

/**
 * 切换 feed 排序并重新加载。
 * @param {object} appContext 应用上下文
 * @param {string} ranking latest | for_you
 * @returns {Promise<void>}
 */
export async function setFeedRanking(appContext, ranking) {
	appContext.state.feedRanking = ranking === 'for_you' ? 'for_you' : 'latest'
	appContext.state.feedCursor = null
	appContext.state.feedPrefetch = null
	appContext.state.feedShownItems = null
	updateFeedRankingTabs(appContext)
	await loadFeed(appContext, false)
}

/**
 * 显示「有新帖」横幅（深分页 / 非首屏 fallback）。
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
	const list = document.getElementById('feedList')
	if (!list) return

	if (append && !appContext.state.feedCursor) {
		await replayFeedItems(appContext)
		return
	}

	const gen = ++feedGeneration
	let items
	let nextCursor

	const cached = append && appContext.state.feedPrefetch
		&& appContext.state.feedPrefetch.cursor === appContext.state.feedCursor
		? appContext.state.feedPrefetch
		: null
	if (cached) {
		items = cached.items
		nextCursor = cached.nextCursor
		appContext.state.feedPrefetch = null
	}
	else {
		const cursorQuery = append && appContext.state.feedCursor
			? `&cursor=${encodeURIComponent(appContext.state.feedCursor)}`
			: ''
		const data = await appContext.socialApi(`/feed?limit=30${feedRankingQuery(appContext)}${cursorQuery}`)
		if (feedGeneration !== gen) return
		items = data.items || []
		nextCursor = data.nextCursor || null
	}
	if (feedGeneration !== gen) return

	const cards = await Promise.all(items.map(item => appContext.buildPostCard(item).catch(() => null)))
	if (feedGeneration !== gen) return

	appContext.state.feedCursor = nextCursor || null
	if (!append) {
		appContext.state.feedShownItems = [...items]
		appContext.state.feedPrefetch = null
	}
	else if (items.length)
		appContext.state.feedShownItems = [...appContext.state.feedShownItems || [], ...items]

	if (!append && !items.length) {
		const emptyElement = await renderTemplate('feed_empty', { emptyKey: 'social.empty.feed' })
		list.replaceChildren(emptyElement)
		appContext.state.feedShownItems = null
	}
	else if (!append) {
		list.replaceChildren(...cards.filter(Boolean))
		updateFeedRankingTabs(appContext)
	}
	else for (const card of cards)
		if (card) list.appendChild(card)

	bindFeedInfiniteScroll(appContext)
	scheduleFeedPrefetch(appContext)
	if (unbindDwell) unbindDwell()
	unbindDwell = bindDwellTracker(list, entries => sendDwellBeacon(appContext, entries))
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
	appContext.state.feedSearchCursor = null
	disconnectInfiniteScroll()
	const [data, entityData] = await Promise.all([
		appContext.socialApi(`/search?q=${encodeURIComponent(q)}&limit=30`),
		appContext.socialApi(`/entities/search?q=${encodeURIComponent(q)}&limit=20`).catch(() => ({ entities: [] })),
	])
	if (appContext.state.activeFeedSearchQuery !== q) return
	const list = document.getElementById('feedList')
	if (!list) return
	const items = data.items || []
	const entities = entityData.entities || []
	const hintElement = await renderTemplate('feed_search_hint', {})
	const frag = document.createDocumentFragment()
	frag.appendChild(hintElement)

	const usersSection = document.createElement('section')
	usersSection.className = 'feed-search-users mb-4'
	const usersTitle = document.createElement('h3')
	usersTitle.className = 'text-sm font-semibold opacity-70 mb-2'
	usersTitle.dataset.i18n = 'social.search.usersTitle'
	usersTitle.textContent = appContext.geti18n('social.search.usersTitle')
	usersSection.appendChild(usersTitle)
	if (!entities.length) {
		const empty = document.createElement('p')
		empty.className = 'text-sm opacity-50'
		empty.textContent = appContext.geti18n('social.search.usersEmpty')
		usersSection.appendChild(empty)
	}
	else 
		for (const entity of entities)
			usersSection.appendChild(buildEntitySearchCard(appContext, entity))
	
	frag.appendChild(usersSection)

	const postsTitle = document.createElement('h3')
	postsTitle.className = 'text-sm font-semibold opacity-70 mb-2'
	postsTitle.dataset.i18n = 'social.search.postsTitle'
	postsTitle.textContent = appContext.geti18n('social.search.postsTitle')
	frag.appendChild(postsTitle)

	if (!items.length) {
		const emptyElement = await renderTemplate('feed_empty', { emptyKey: 'social.search.empty' })
		frag.appendChild(emptyElement)
		list.replaceChildren(frag)
	}
	else {
		const container = document.createElement('div')
		container.id = 'feedSearchResults'
		const cardEls = await Promise.all(items.map(item => appContext.buildPostCard(item).catch(() => null)))
		for (const card of cardEls) if (card) container.appendChild(card)
		frag.appendChild(container)
		list.replaceChildren(frag)
		appContext.state.feedSearchCursor = data.nextCursor || null
		const sentinel = ensureScrollSentinel(list, 'feedSearchScrollSentinel')
		bindInfiniteScroll({
			sentinel,
			/**
			 * @returns {boolean} 是否还有下一页
			 */
			hasMore: () => !!appContext.state.feedSearchCursor,
			/**
			 * @returns {Promise<void>} 追加下一页
			 */
			onLoad: () => appendFeedSearch(appContext),
		})
	}
	updateFeedSearchChrome(appContext)
}

/**
 * @param {object} appContext 应用上下文
 * @param {object} entity 搜索命中实体
 * @returns {HTMLElement} 卡片
 */
function buildEntitySearchCard(appContext, entity) {
	const row = document.createElement('div')
	row.className = 'suggested-account feed-search-entity'
	const handle = entity.handle ? `@${entity.handle}` : entityHandle(entity.entityHash)
	const label = entity.alias || entity.name || handle
	const followLabel = entity.following
		? appContext.geti18n('social.actions.following')
		: appContext.geti18n('social.actions.follow')
	row.innerHTML = `
		<div class="suggested-account-info">
			<a href="${escapeHtml(formatSocialProfileHref(entity.entityHash))}" class="suggested-account-name">${escapeHtml(label)}</a>
			<span class="suggested-account-handle">${escapeHtml(handle)}</span>
			<span class="text-xs opacity-50">${escapeHtml(appContext.geti18n('social.search.trustScore', { score: Number(entity.nodeScore || 0).toFixed(2) }))}</span>
		</div>
		<div class="flex gap-1 flex-wrap justify-end">
			<button type="button" class="suggested-follow-btn" data-follow="${escapeHtml(entity.entityHash)}" data-is-following="${entity.following ? 'true' : 'false'}">${escapeHtml(followLabel)}</button>
			<button type="button" class="btn btn-ghost btn-xs" data-set-alias="${escapeHtml(entity.entityHash)}">${escapeHtml(appContext.geti18n('social.search.pinAlias'))}</button>
		</div>
	`
	return row
}

/**
 * 搜索分页追加。
 * @param {object} appContext 应用上下文
 * @returns {Promise<void>}
 */
export async function appendFeedSearch(appContext) {
	const q = appContext.state.activeFeedSearchQuery
	if (!q || !appContext.state.feedSearchCursor) return
	const data = await appContext.socialApi(
		`/search?q=${encodeURIComponent(q)}&limit=30&cursor=${encodeURIComponent(appContext.state.feedSearchCursor)}`,
	)
	if (appContext.state.activeFeedSearchQuery !== q) return
	const container = document.getElementById('feedSearchResults')
	if (!container) return
	const items = data.items || []
	for (const item of items) {
		const card = await appContext.buildPostCard(item).catch(() => null)
		if (card) container.appendChild(card)
	}
	appContext.state.feedSearchCursor = data.nextCursor || null
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
	appContext.state.feedShownItems = null
	appContext.state.feedPrefetch = null
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
