import { formatSocialTopicHref, formatSocialProfileHref } from '../../shared/runUri.mjs'
import { bindDwellTracker } from '../dwellTracker.mjs'
import { socialApi } from '../lib/apiClient.mjs'
import { entityHandle } from '../lib/display.mjs'
import { mountEmptyState } from '../lib/emptyState.mjs'
import { appendFeedItemsWithThreads } from '../lib/feedThreads.mjs'
import { renderSuggestedAccountRows } from '../lib/suggestedAccounts.mjs'
import { buildPostCard } from '../postCard.mjs'
import { state } from '../state.mjs'
import { renderTemplate } from '/scripts/features/template.mjs'
import { bindInfiniteScroll, disconnectInfiniteScroll, ensureScrollSentinel } from '/scripts/infiniteScroll.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

/** @type {(() => void) | null} */
let unbindDwell = null

/**
 * 更新 feed 侧栏搜索清除按钮可见性。
 * @returns {void}
 */
export function updateFeedSearchChrome() {
	const clearButton = document.getElementById('feedSearchClearButton')
	const hasSearch = !!state.activeFeedSearchQuery
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
	if (!list || state.activeFeedSearchQuery) {
		disconnectInfiniteScroll()
		return
	}
	const sentinel = ensureScrollSentinel(list, 'feedScrollSentinel')
	bindInfiniteScroll({
		sentinel,
		rootMargin: '480px 0px',
		/** @returns {boolean} 有下一页或可循环重放 */
		hasMore: () => !!state.feedCursor
			|| (!!state.feedShownItems?.length && canReplayFeed()),
		/** @returns {Promise<void>} 追加下一页或循环重放 */
		onLoad: () => loadFeed(true),
	})
}

/**
 * 后台预取下一页（结果缓存在 state.feedPrefetch）。
 * @returns {void}
 */
function scheduleFeedPrefetch() {
	const cursor = state.feedCursor
	if (!cursor || state.activeFeedSearchQuery) return
	if (state.feedPrefetch?.cursor === cursor) return
	if (state.feedPrefetchInFlight) return
	const gen = feedGeneration
	state.feedPrefetchInFlight = (async () => {
		const data = await socialApi(
			`/feed?limit=30${feedRankingQuery()}&cursor=${encodeURIComponent(cursor)}`,
		).catch(() => null)
		if (feedGeneration !== gen) return
		if (!data || state.feedCursor !== cursor) return
		state.feedPrefetch = {
			cursor,
			items: data.items || [],
			nextCursor: data.nextCursor || null,
		}
	})().finally(() => {
		state.feedPrefetchInFlight = null
	})
}

/**
 * 循环重放已展示条目。
 * @returns {Promise<void>}
 */
async function replayFeedItems() {
	const items = state.feedShownItems
	if (!items?.length) return
	const list = document.getElementById('feedList')
	if (!list) return
	const divider = document.createElement('div')
	divider.className = 'feed-replay-divider text-center text-sm opacity-50 py-3'
	divider.dataset.i18n = 'social.feed.replayDivider'
	list.appendChild(divider)
	await appendFeedItemsWithThreads(list, items, item => buildPostCard(item).catch(() => null))
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
		row => row.entityHash !== state.viewerEntityHash,
	)
	if (!accounts.length) {
		aside.classList.add('hidden')
		list.replaceChildren()
		return
	}
	aside.classList.remove('hidden')
	await renderSuggestedAccountRows(list, accounts)
}

/**
 * 加载并渲染热门话题标签。
 * @param {'local' | 'nearby'} [scope='local'] 范围
 * @param {string} [containerId='feedTrending'] 容器 id
 * @returns {Promise<void>}
 */
export async function loadTrendingHashtags(scope = 'local', containerId = 'feedTrending') {
	const aside = document.getElementById(containerId)
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
	}))
	const list = document.createElement('div')
	list.className = 'trending-tags'
	if (!tags.length)
		await mountEmptyState(list, { titleKey: 'social.trending.empty', modClass: ' empty-state--hint' })
	else
		for (const row of tags) {
			const link = document.createElement('a')
			link.className = 'trending-tag link-btn'
			link.href = formatSocialTopicHref(row.tag)
			link.textContent = `#${row.tag}`
			const count = document.createElement('span')
			count.className = 'trending-count'
			count.textContent = String(row.count)
			link.appendChild(count)
			link.dataset.n = String(row.count)
			link.dataset.i18n = 'social.trending.postCount'
			list.appendChild(link)
		}

	aside.appendChild(list)
	aside.querySelectorAll('[data-trending-scope]').forEach(btn => {
		btn.addEventListener('click', () => {
			const next = btn.getAttribute('data-trending-scope') === 'nearby' ? 'nearby' : 'local'
			void loadTrendingHashtags(next, containerId)
		})
	})
}

/**
 * 在 feed 顶部插入单条帖子卡片（WS 真增量）。
 * @param {object} item feed 条目
 * @returns {Promise<boolean>} 是否成功插入
 */
export async function prependFeedItem(item) {
	if (state.activeFeedSearchQuery) return false
	if (state.feedCursor) return false
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
	return state.feedRanking === 'for_you' ? '&ranking=for_you' : ''
}

/**
 * 更新 feed 排序 tab 高亮。
 * @returns {void}
 */
export function updateFeedRankingTabs() {
	for (const tab of document.querySelectorAll('[data-feed-ranking]')) {
		if (!(tab instanceof HTMLElement)) continue
		const active = tab.dataset.feedRanking === state.feedRanking
		tab.classList.toggle('active', active)
		tab.setAttribute('aria-selected', active ? 'true' : 'false')
		tab.setAttribute('role', 'tab')
	}
}

/**
 * 切换 feed 排序并重新加载。
 * @param {string} ranking latest | for_you
 * @returns {Promise<void>}
 */
export async function setFeedRanking(ranking) {
	state.feedRanking = ranking === 'for_you' ? 'for_you' : 'latest'
	state.feedCursor = null
	state.feedPrefetch = null
	state.feedShownItems = null
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
	if (state.activeFeedSearchQuery) return
	if (document.getElementById('feedNewPostsBanner')) return
	const banner = document.createElement('button')
	banner.type = 'button'
	banner.id = 'feedNewPostsBanner'
	banner.className = 'feed-new-posts-banner btn btn-primary btn-sm'
	banner.dataset.i18n = 'social.feed.newPosts'
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
	if (state.activeFeedSearchQuery) return
	const list = document.getElementById('feedList')
	if (!list) return

	if (append && !state.feedCursor) {
		await replayFeedItems()
		return
	}

	const gen = ++feedGeneration
	let items
	let nextCursor

	const cached = append && state.feedPrefetch
		&& state.feedPrefetch.cursor === state.feedCursor
		? state.feedPrefetch
		: null
	if (cached) {
		items = cached.items
		nextCursor = cached.nextCursor
		state.feedPrefetch = null
	}
	else {
		const cursorQuery = append && state.feedCursor
			? `&cursor=${encodeURIComponent(state.feedCursor)}`
			: ''
		const data = await socialApi(`/feed?limit=30${feedRankingQuery()}${cursorQuery}`)
		if (feedGeneration !== gen) return
		items = data.items || []
		nextCursor = data.nextCursor || null
	}
	if (feedGeneration !== gen) return

	state.feedCursor = nextCursor || null
	if (!append) {
		state.feedShownItems = [...items]
		state.feedPrefetch = null
	}
	else if (items.length)
		state.feedShownItems = [...state.feedShownItems || [], ...items]

	if (!append && !items.length) {
		await mountEmptyState(list, { titleKey: 'social.empty.feed', modClass: ' empty-state--plain' })
		state.feedShownItems = null
	}
	else if (!append) {
		list.replaceChildren()
		await appendFeedItemsWithThreads(list, items, item => buildPostCard(item).catch(() => null))
		if (feedGeneration !== gen) return
		updateFeedRankingTabs()
	}
	else
		await appendFeedItemsWithThreads(list, items, item => buildPostCard(item).catch(() => null))

	bindFeedInfiniteScroll()
	scheduleFeedPrefetch()
	if (unbindDwell) unbindDwell()
	unbindDwell = bindDwellTracker(list)
	const { bindFeedVideoAutoplay } = await import('../lib/videoAutoplay.mjs')
	bindFeedVideoAutoplay(list)
	void loadTrendingHashtags()
	void loadSuggestedAccounts()
}

/**
 * @param {object} entity 搜索命中实体
 * @returns {Promise<HTMLElement>} 卡片
 */
export async function buildEntitySearchCard(entity) {
	const handle = entityHandle(entity.entityHash, entity)
	const label = entity.alias || entity.name || handle
	return renderTemplate('feed_entity_search', {
		profileHref: escapeHtml(formatSocialProfileHref(entity.entityHash)),
		label: escapeHtml(label),
		handle: escapeHtml(handle),
		score: Number(entity.nodeScore || 0).toFixed(2),
		entityHash: escapeHtml(entity.entityHash),
		isFollowing: entity.following ? 'true' : 'false',
		followI18n: entity.following ? 'social.actions.following' : 'social.actions.follow',
	})
}
