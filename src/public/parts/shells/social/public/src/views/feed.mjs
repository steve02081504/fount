import { renderTemplate } from '../../../../../scripts/features/template.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { formatSocialTopicHref, formatSocialProfileHref } from '../../shared/runUri.mjs'
import { bindDwellTracker, sendDwellBeacon } from '../dwellTracker.mjs'
import { socialApi } from '../lib/apiClient.mjs'
import { entityHandle, renderAvatarHtml } from '../lib/display.mjs'
import { bindInfiniteScroll, disconnectInfiniteScroll, ensureScrollSentinel } from '/scripts/infiniteScroll.mjs'
import { buildPostCard } from '../postCard.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'
import { socialState } from '../state.mjs'
import { activateView } from '../viewChrome.mjs'

/** @type {(() => void) | null} */
let unbindDwell = null

/**
 * 加载并渲染 Feed 页。
 * 更新 feed 搜索栏与加载更多的 UI 状态。
 * @returns {void}
 */
export function updateFeedSearchChrome() {
	const clearButton = document.getElementById('feedSearchClearButton')
	const hasSearch = !!socialState.activeFeedSearchQuery
	clearButton?.classList.toggle('hidden', !hasSearch)
}

/**
 * 循环重放仅在用户已真实下滚且内容高于视口时允许，避免短 feed 首屏自动复制。
 * @returns {boolean} 是否允许重放
 */
function canReplayFeed() {
	const list = document.getElementById('feedList')
	if (!list?.children.length) return false
	const scrolled = (window.scrollY || document.documentElement.scrollTop) > 0
	if (!scrolled) return false
	return document.documentElement.scrollHeight > window.innerHeight
}

/**
 * 绑定 feed 无限滚动。
 * @returns {void}
 */
export function bindFeedInfiniteScroll() {
	const list = document.getElementById('feedList')
	if (!list || socialState.activeFeedSearchQuery) {
		disconnectInfiniteScroll()
		return
	}
	const sentinel = ensureScrollSentinel(list, 'feedScrollSentinel')
	bindInfiniteScroll({
		sentinel,
		rootMargin: '480px 0px',
		/** @returns {boolean} 有下一页或可循环重放 */
		hasMore: () => !!socialState.feedCursor
			|| (!!socialState.feedShownItems?.length && canReplayFeed()),
		/** @returns {Promise<void>} 追加下一页或循环重放 */
		onLoad: () => loadFeed(true),
	})
}

/**
 * 后台预取下一页（结果缓存在 state.feedPrefetch）。
 * @returns {void}
 */
function scheduleFeedPrefetch() {
	const cursor = socialState.feedCursor
	if (!cursor || socialState.activeFeedSearchQuery) return
	if (socialState.feedPrefetch?.cursor === cursor) return
	if (socialState.feedPrefetchInFlight) return
	const gen = feedGeneration
	socialState.feedPrefetchInFlight = (async () => {
		const data = await socialApi(
			`/feed?limit=30${feedRankingQuery()}&cursor=${encodeURIComponent(cursor)}`,
		).catch(() => null)
		if (feedGeneration !== gen) return
		if (!data || socialState.feedCursor !== cursor) return
		socialState.feedPrefetch = {
			cursor,
			items: data.items || [],
			nextCursor: data.nextCursor || null,
		}
	})().finally(() => {
		socialState.feedPrefetchInFlight = null
	})
}

/**
 * 循环重放已展示条目。
 * @returns {Promise<void>}
 */
async function replayFeedItems() {
	const items = socialState.feedShownItems
	if (!items?.length) return
	const list = document.getElementById('feedList')
	if (!list) return
	const divider = document.createElement('div')
	divider.className = 'feed-replay-divider text-center text-sm opacity-50 py-3'
	divider.dataset.i18n = 'social.feed.replayDivider'
	divider.textContent = geti18n('social.feed.replayDivider')
	list.appendChild(divider)
	const cards = await Promise.all(items.map(item => buildPostCard(item).catch(() => null)))
	for (const card of cards) if (card) list.appendChild(card)
	// 只把哨兵挪到尾部，不重绑 observer——否则哨兵仍在视口内时会立刻再触发形成死循环
	ensureScrollSentinel(list, 'feedScrollSentinel')
}

/**
 * 加载并渲染右栏推荐关注账户。
 * @returns {Promise<void>}
 */
export async function loadSuggestedAccounts() {
	const aside = document.getElementById('asideSuggested')
	const list = document.getElementById('asideSuggestedList')
	if (!aside || !list) return
	const data = await socialApi('/explore?limit=5').catch(() => ({ accounts: [] }))
	const accounts = (data.accounts || []).filter(
		row => row.entityHash !== socialState.viewerEntityHash,
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
			${renderAvatarHtml(account.entityHash, { name: account.name })}
			<div class="suggested-account-info">
				<a href="${escapeHtml(formatSocialProfileHref(account.entityHash))}" class="suggested-account-name">${escapeHtml(account.name)}</a>
				<span class="suggested-account-handle">${escapeHtml(entityHandle(account.entityHash))}</span>
			</div>
			<button type="button" class="suggested-follow-btn" data-follow="${escapeHtml(account.entityHash)}">${escapeHtml(geti18n('social.actions.follow'))}</button>
		`
		list.appendChild(row)
	}
}

/**
 * 加载并渲染侧边栏热门话题标签。
 * @param {'local' | 'nearby'} [scope='local'] 范围
 * @returns {Promise<void>}
 */
export async function loadTrendingHashtags(scope = 'local') {
	const aside = document.getElementById('feedTrending')
	if (!aside) return
	const currentScope = scope === 'nearby' ? 'nearby' : 'local'
	aside.dataset.trendingScope = currentScope
	const data = await socialApi(`/hashtags/trending?limit=12&scope=${currentScope}`).catch(() => ({ tags: [] }))
	const tags = data.tags || []
	aside.classList.remove('hidden')
	aside.replaceChildren()
	aside.appendChild(await renderTemplate('trending_header', {
		localActive: currentScope === 'local' ? 'active' : '',
		nearbyActive: currentScope === 'nearby' ? 'active' : '',
		localLabel: geti18n('social.trending.scopeLocal'),
		nearbyLabel: geti18n('social.trending.scopeNearby'),
	}))
	const list = document.createElement('div')
	list.className = 'trending-tags'
	if (!tags.length)
		list.innerHTML = `<p class="empty-hint">${geti18n('social.trending.empty')}</p>`
	else
		for (const row of tags) {
			const link = document.createElement('a')
			link.className = 'trending-tag link-btn'
			link.href = formatSocialTopicHref(row.tag)
			link.textContent = `#${row.tag}`
			link.title = geti18n('social.trending.postCount', { n: row.count })
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
			void loadTrendingHashtags(next)
		})
	})
}

/**
 * 在 feed 顶部插入单条帖子卡片（WS 真增量）。
 * @param {object} item feed 条目
 * @returns {Promise<boolean>} 是否成功插入
 */
export async function prependFeedItem(item) {
	if (socialState.activeFeedSearchQuery) return false
	if (socialState.feedCursor) return false
	const feedView = document.getElementById('feedView')
	if (!feedView || feedView.classList.contains('hidden')) return false
	const list = document.getElementById('feedList')
	if (!list) return false
	document.getElementById('feedNewPostsBanner')?.remove()
	const card = await buildPostCard(item).catch(() => null)
	if (!card) return false
	const empty = list.querySelector('.feed-empty')
	if (empty) list.replaceChildren(card)
	else list.prepend(card)
	return true
}

/**
 * @returns {string} feed ranking query 片段
 */
function feedRankingQuery() {
	return socialState.feedRanking === 'for_you' ? '&ranking=for_you' : ''
}

/**
 * 更新 feed 排序 tab 高亮。
 * @returns {void}
 */
export function updateFeedRankingTabs() {
	for (const tab of document.querySelectorAll('[data-feed-ranking]')) {
		if (!(tab instanceof HTMLElement)) continue
		tab.classList.toggle('active', tab.dataset.feedRanking === socialState.feedRanking)
	}
}

/**
 * 切换 feed 排序并重新加载。
 * @param {string} ranking latest | for_you
 * @returns {Promise<void>}
 */
export async function setFeedRanking(ranking) {
	socialState.feedRanking = ranking === 'for_you' ? 'for_you' : 'latest'
	socialState.feedCursor = null
	socialState.feedPrefetch = null
	socialState.feedShownItems = null
	updateFeedRankingTabs()
	await loadFeed(false)
}

/**
 * 显示「有新帖」横幅（深分页 / 非首屏 fallback）。
 * @returns {void}
 */
export function showFeedNewPostsBanner() {
	const feedView = document.getElementById('feedView')
	if (!feedView || feedView.classList.contains('hidden')) return
	if (socialState.activeFeedSearchQuery) return
	if (document.getElementById('feedNewPostsBanner')) return
	const banner = document.createElement('button')
	banner.type = 'button'
	banner.id = 'feedNewPostsBanner'
	banner.className = 'feed-new-posts-banner btn btn-primary btn-sm'
	banner.textContent = geti18n('social.feed.newPosts')
	banner.addEventListener('click', () => {
		banner.remove()
		void loadFeed(false)
	})
	document.getElementById('feedList')?.before(banner)
}

let feedGeneration = 0

/**
 * 加载首页 feed（分页）。
 * @param {boolean} [append=false] 追加
 * @returns {Promise<void>}
 */
export async function loadFeed(append = false) {
	if (socialState.activeFeedSearchQuery) return
	const list = document.getElementById('feedList')
	if (!list) return

	if (append && !socialState.feedCursor) {
		await replayFeedItems()
		return
	}

	const gen = ++feedGeneration
	let items
	let nextCursor

	const cached = append && socialState.feedPrefetch
		&& socialState.feedPrefetch.cursor === socialState.feedCursor
		? socialState.feedPrefetch
		: null
	if (cached) {
		items = cached.items
		nextCursor = cached.nextCursor
		socialState.feedPrefetch = null
	}
	else {
		const cursorQuery = append && socialState.feedCursor
			? `&cursor=${encodeURIComponent(socialState.feedCursor)}`
			: ''
		const data = await socialApi(`/feed?limit=30${feedRankingQuery()}${cursorQuery}`)
		if (feedGeneration !== gen) return
		items = data.items || []
		nextCursor = data.nextCursor || null
	}
	if (feedGeneration !== gen) return

	const cards = await Promise.all(items.map(item => buildPostCard(item).catch(() => null)))
	if (feedGeneration !== gen) return

	socialState.feedCursor = nextCursor || null
	if (!append) {
		socialState.feedShownItems = [...items]
		socialState.feedPrefetch = null
	}
	else if (items.length)
		socialState.feedShownItems = [...socialState.feedShownItems || [], ...items]

	if (!append && !items.length) {
		const emptyElement = await renderTemplate('feed_empty', { emptyKey: 'social.empty.feed' })
		list.replaceChildren(emptyElement)
		socialState.feedShownItems = null
	}
	else if (!append) {
		list.replaceChildren(...cards.filter(Boolean))
		updateFeedRankingTabs()
	}
	else for (const card of cards)
		if (card) list.appendChild(card)

	bindFeedInfiniteScroll()
	scheduleFeedPrefetch()
	if (unbindDwell) unbindDwell()
	unbindDwell = bindDwellTracker(list, entries => sendDwellBeacon(entries))
	void loadTrendingHashtags()
	void loadSuggestedAccounts()
}

/**
 * 执行 feed 关键词/话题搜索并渲染结果。
 * @returns {Promise<void>}
 */
export async function runFeedSearch() {
	const input = document.getElementById('feedSearchInput')
	const q = input instanceof HTMLInputElement ? input.value.trim() : ''
	if (q.length < 2) {
		disconnectInfiniteScroll()
		const list = document.getElementById('feedList')
		const emptyElement = list ? await renderTemplate('feed_empty', { emptyKey: 'social.search.tooShort' }) : null
		if (list && emptyElement) list.replaceChildren(emptyElement)
		socialState.activeFeedSearchQuery = null
		updateFeedSearchChrome()
		return
	}
	socialState.activeFeedSearchQuery = q
	socialState.feedSearchCursor = null
	disconnectInfiniteScroll()
	const [data, entityData] = await Promise.all([
		socialApi(`/search?q=${encodeURIComponent(q)}&limit=30`),
		socialApi(`/entities/search?q=${encodeURIComponent(q)}&limit=20`).catch(() => ({ entities: [] })),
	])
	if (socialState.activeFeedSearchQuery !== q) return
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
	usersTitle.textContent = geti18n('social.search.usersTitle')
	usersSection.appendChild(usersTitle)
	if (!entities.length) {
		const empty = document.createElement('p')
		empty.className = 'text-sm opacity-50'
		empty.textContent = geti18n('social.search.usersEmpty')
		usersSection.appendChild(empty)
	}
	else 
		for (const entity of entities)
			usersSection.appendChild(buildEntitySearchCard(entity))
	
	frag.appendChild(usersSection)

	const postsTitle = document.createElement('h3')
	postsTitle.className = 'text-sm font-semibold opacity-70 mb-2'
	postsTitle.dataset.i18n = 'social.search.postsTitle'
	postsTitle.textContent = geti18n('social.search.postsTitle')
	frag.appendChild(postsTitle)

	if (!items.length) {
		const emptyElement = await renderTemplate('feed_empty', { emptyKey: 'social.search.empty' })
		frag.appendChild(emptyElement)
		list.replaceChildren(frag)
	}
	else {
		const container = document.createElement('div')
		container.id = 'feedSearchResults'
		const cardEls = await Promise.all(items.map(item => buildPostCard(item).catch(() => null)))
		for (const card of cardEls) if (card) container.appendChild(card)
		frag.appendChild(container)
		list.replaceChildren(frag)
		socialState.feedSearchCursor = data.nextCursor || null
		const sentinel = ensureScrollSentinel(list, 'feedSearchScrollSentinel')
		bindInfiniteScroll({
			sentinel,
			/**
			 * @returns {boolean} 是否还有下一页
			 */
			hasMore: () => !!socialState.feedSearchCursor,
			/**
			 * @returns {Promise<void>} 追加下一页
			 */
			onLoad: () => appendFeedSearch(),
		})
	}
	updateFeedSearchChrome()
}

/**
 * @param {object} entity 搜索命中实体
 * @returns {HTMLElement} 卡片
 */
function buildEntitySearchCard(entity) {
	const row = document.createElement('div')
	row.className = 'suggested-account feed-search-entity'
	const handle = entity.handle ? `@${entity.handle}` : entityHandle(entity.entityHash)
	const label = entity.alias || entity.name || handle
	const followLabel = entity.following
		? geti18n('social.actions.following')
		: geti18n('social.actions.follow')
	row.innerHTML = `
		<div class="suggested-account-info">
			<a href="${escapeHtml(formatSocialProfileHref(entity.entityHash))}" class="suggested-account-name">${escapeHtml(label)}</a>
			<span class="suggested-account-handle">${escapeHtml(handle)}</span>
			<span class="text-xs opacity-50">${escapeHtml(geti18n('social.search.trustScore', { score: Number(entity.nodeScore || 0).toFixed(2) }))}</span>
		</div>
		<div class="flex gap-1 flex-wrap justify-end">
			<button type="button" class="suggested-follow-btn" data-follow="${escapeHtml(entity.entityHash)}" data-is-following="${entity.following ? 'true' : 'false'}">${escapeHtml(followLabel)}</button>
			<button type="button" class="btn btn-ghost btn-xs" data-set-alias="${escapeHtml(entity.entityHash)}">${escapeHtml(geti18n('social.search.pinAlias'))}</button>
		</div>
	`
	return row
}

/**
 * 搜索分页追加。
 * @returns {Promise<void>}
 */
export async function appendFeedSearch() {
	const q = socialState.activeFeedSearchQuery
	if (!q || !socialState.feedSearchCursor) return
	const data = await socialApi(
		`/search?q=${encodeURIComponent(q)}&limit=30&cursor=${encodeURIComponent(socialState.feedSearchCursor)}`,
	)
	if (socialState.activeFeedSearchQuery !== q) return
	const container = document.getElementById('feedSearchResults')
	if (!container) return
	const items = data.items || []
	for (const item of items) {
		const card = await buildPostCard(item).catch(() => null)
		if (card) container.appendChild(card)
	}
	socialState.feedSearchCursor = data.nextCursor || null
}

/**
 * 清除搜索状态并恢复默认 feed。
 * @returns {Promise<void>}
 */
export async function clearFeedSearch() {
	socialState.activeFeedSearchQuery = null
	disconnectInfiniteScroll()
	const input = document.getElementById('feedSearchInput')
	if (input instanceof HTMLInputElement) input.value = ''
	socialState.feedCursor = null
	socialState.feedShownItems = null
	socialState.feedPrefetch = null
	await loadFeed(false)
	updateFeedSearchChrome()
}

/**
 * 切换到 feed 视图并执行指定搜索。
 * @param {string} query 搜索词
 * @returns {Promise<void>}
 */
export async function openSearchView(query) {
	const q = String(query || '').trim()
	if (!q) return
	activateView('feed')
	const input = document.getElementById('feedSearchInput')
	if (input instanceof HTMLInputElement)
		input.value = q
	await runFeedSearch()
}
