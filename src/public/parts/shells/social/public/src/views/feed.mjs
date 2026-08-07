import { formatSocialTopicHref, formatSocialProfileHref } from '../../shared/runUri.mjs'
import { bindDwellTracker } from '../dwellTracker.mjs'
import { getExploreAccounts, getFeed, getTrendingHashtags } from '../endpoints/feed.mjs'
import { entityHandle } from '../lib/display.mjs'
import { mountEmptyState } from '../lib/emptyState.mjs'
import { appendFeedItemsWithThreads } from '../lib/feedThreads.mjs'
import { renderSuggestedAccountRows } from '../lib/suggestedAccounts.mjs'
import { buildPostCard } from '../postCard.mjs'
import { state } from '../state.mjs'
import { renderTemplate } from '/scripts/features/template.mjs'
import { bindInfiniteScroll, disconnectInfiniteScroll, ensureScrollSentinel, insertBeforeScrollSentinel } from '/scripts/lib/infiniteScroll.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'

/** @type {(() => void) | null} */
let unbindDwell = null

/** 会话内附近趋势缓存 */
/** @type {{ tag: string, count: number }[] | null} */
let trendingCache = null

/** 在途附近趋势请求（去重） */
/** @type {Promise<{ tag: string, count: number }[] | null> | null} */
let trendingInFlight = null

/**
 * 更新 feed 侧栏搜索清除按钮可见性。
 * @returns {void}
 */
export function updateFeedSearchChrome() {
	const clearButton = document.getElementById('feedSearchClearButton')
	const hasSearch = !!state.activeFeedSearchQuery
	clearButton?.classList.toggle('hidden', !hasSearch)
}

/** 用户是否滚动过（重放门槛）；每次首屏 loadFeed(false) 重置 */
let feedUserScrolled = false

/** 正在 build/插入的 feed 键，堵住本机 force 与 WS 在 await 窗口双插 */
const pendingFeedInserts = new Set()

/**
 * 循环重放仅在用户已真实滚动且内容高于视口时允许，避免短 feed 首屏自动复制。
 * @returns {boolean} 是否允许重放
 */
function canReplayFeed() {
	const list = document.getElementById('feedList')
	if (!list?.children.length) return false
	if (!feedUserScrolled) return false
	return document.documentElement.scrollHeight > window.innerHeight
}

/**
 * 首次滚动后允许重放，并重绑 IO（rising-edge 重新武装）。
 * @returns {void}
 */
function onFeedWindowScroll() {
	feedUserScrolled = true
	if (!state.feedCursor && state.feedShownItems?.length)
		bindFeedInfiniteScroll()
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
		try {
			const data = await getFeed({ cursor, ranking: state.feedRanking })
			if (feedGeneration !== gen) return
			if (!data || state.feedCursor !== cursor) return
			state.feedPrefetch = {
				cursor,
				items: data.items || [],
				nextCursor: data.nextCursor || null,
			}
		}
		catch {
			/* 预取失败可忽略，下次滚动再拉 */
		}
		finally {
			state.feedPrefetchInFlight = null
		}
	})()
}

/**
 * 构建帖子卡片；若构建期间该帖已被压制则返回 null。
 * @param {object} item feed 条目
 * @returns {Promise<HTMLElement | null>} 卡片，或构建中被压制时为 null
 */
async function buildFeedCardUnlessSuppressed(item) {
	const card = await buildPostCard(item).catch(() => null)
	if (!card) return null
	if (state.suppressedFeedPostIds.has(item.postId)) return null
	return card
}

/**
 * 循环重放已展示条目。
 * @returns {Promise<void>}
 */
async function replayFeedItems() {
	const items = (state.feedShownItems || []).filter(item =>
		!state.suppressedFeedPostIds.has(item.postId),
	)
	if (!items.length) return
	const list = document.getElementById('feedList')
	if (!list) return
	// 哨兵须已在尾；追加不重绑 observer
	ensureScrollSentinel(list, 'feedScrollSentinel')
	list.dataset.feedReplaying = '1'
	try {
		const divider = document.createElement('div')
		divider.className = 'feed-replay-divider text-center text-sm opacity-50 py-3'
		divider.dataset.i18n = 'social.feed.replayDivider'
		insertBeforeScrollSentinel(list, divider)
		await appendFeedItemsWithThreads(list, items, buildFeedCardUnlessSuppressed)
	}
	finally {
		delete list.dataset.feedReplaying
	}
}

/**
 * 加载并渲染右栏推荐关注账户。
 * @returns {Promise<void>}
 */
export async function loadSuggestedAccounts() {
	const aside = document.getElementById('asideSuggested')
	const list = document.getElementById('asideSuggestedList')
	if (!aside || !list) return
	let data
	try {
		data = await getExploreAccounts(5)
	}
	catch {
		data = { accounts: [] }
	}
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
 * 加载并渲染热门话题（附近聚合；缓存/本机即时回退）。
 * @param {string} [containerId='feedTrending'] 容器 id
 * @returns {Promise<void>}
 */
export async function loadTrendingHashtags(containerId = 'feedTrending') {
	const aside = document.getElementById(containerId)
	if (!aside) return

	/**
	 * @param {{ tag: string, count: number }[]} tags 话题行
	 * @returns {Promise<void>}
	 */
	async function paint(tags) {
		aside.classList.remove('hidden')
		aside.replaceChildren()
		aside.appendChild(await renderTemplate('trending_header', {}))
		const list = document.createElement('div')
		list.className = 'trending-tags'
		if (!tags.length)
			await mountEmptyState(list, { titleKey: 'social.feed.trending.empty', modClass: ' empty-state--hint' })
		else
			for (const row of tags) {
				const link = document.createElement('a')
				link.className = 'trending-tag link-btn'
				link.href = formatSocialTopicHref(row.tag)
				link.textContent = `#${row.tag}`
				const count = document.createElement('span')
				count.className = 'trending-count'
				count.dataset.n = String(row.count)
				count.dataset.i18n = 'social.feed.trending.postCount'
				link.appendChild(count)
				list.appendChild(link)
			}
		aside.appendChild(list)
	}

	if (trendingCache?.length)
		await paint(trendingCache)

	if (!trendingInFlight)
		trendingInFlight = (async () => {
			try {
				const data = await getTrendingHashtags({ scope: 'nearby' })
				trendingCache = data.tags || []
				return trendingCache
			}
			catch {
				return trendingCache
			}
			finally {
				trendingInFlight = null
			}
		})()
	const nearbyPromise = trendingInFlight
	const localPromise = !trendingCache?.length
		? (async () => {
			try {
				return await getTrendingHashtags({ scope: 'local' })
			}
			catch {
				return { tags: [] }
			}
		})()
		: null

	const nearbyTags = await nearbyPromise
	if (nearbyTags?.length) {
		await paint(nearbyTags)
		return
	}

	if (localPromise) {
		const local = await localPromise
		await paint(local.tags || [])
	}
}

/**
 * 在 feed 顶部插入单条帖子卡片（WS / 本机写操作增量）。
 * @param {object} item feed 条目
 * @param {{ force?: boolean }} [options] force：本机写操作忽略深分页 cursor 限制
 * @returns {Promise<boolean>} 是否成功插入
 */
export async function prependFeedItem(item, options = {}) {
	if (state.activeFeedSearchQuery) return false
	const feedView = document.getElementById('feedView')
	if (!feedView || feedView.classList.contains('hidden')) return false
	const list = document.getElementById('feedList')
	if (!list) return false
	const postId = item.postId
	const entityHash = item.entityHash
	if (state.suppressedFeedPostIds.has(postId)) return false
	const insertKey = `${entityHash}:${postId}`
	// 已在列表：在 cursor 门闩之前返回，避免本机 force 插入后 WS 再弹「有新帖」
	if (list.querySelector(
		`.post-card[data-post-id="${CSS.escape(postId)}"][data-author-entity="${CSS.escape(entityHash)}"]`,
	))
		return true
	if (!options.force && state.feedCursor) return false
	if (pendingFeedInserts.has(insertKey)) return true
	pendingFeedInserts.add(insertKey)
	try {
		document.getElementById('feedNewPostsBanner')?.remove()
		const card = await buildPostCard(item).catch(() => null)
		if (!card) return false
		// buildPostCard 期间可能已删除：再挡一次迟到回插
		if (state.suppressedFeedPostIds.has(postId)) return false
		if (list.querySelector(
			`.post-card[data-post-id="${CSS.escape(postId)}"][data-author-entity="${CSS.escape(entityHash)}"]`,
		))
			return true
		const empty = list.querySelector('.feed-empty')
		if (empty) list.replaceChildren(card)
		else list.prepend(card)
		state.feedShownItems = [item, ...state.feedShownItems || []]
		return true
	}
	finally {
		pendingFeedInserts.delete(insertKey)
	}
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
		tab.classList.toggle('tab-active', active)
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
		const cursor = append && state.feedCursor ? state.feedCursor : undefined
		let data
		try {
			data = await getFeed({ cursor, ranking: state.feedRanking })
		}
		catch (error) {
			handleError('social.feed.loadFailed', {}, error)
			return
		}
		if (feedGeneration !== gen) return
		items = data.items || []
		nextCursor = data.nextCursor || null
	}
	if (feedGeneration !== gen) return

	const visibleItems = (items || []).filter(item =>
		!state.suppressedFeedPostIds.has(item.postId),
	)

	state.feedCursor = nextCursor || null
	if (!append) {
		feedUserScrolled = false
		window.removeEventListener('scroll', onFeedWindowScroll)
		window.addEventListener('scroll', onFeedWindowScroll, { passive: true, once: true })
		state.feedShownItems = [...visibleItems]
		state.feedPrefetch = null
	}
	else if (visibleItems.length)
		state.feedShownItems = [...state.feedShownItems || [], ...visibleItems]

	if (!append && !visibleItems.length && !state.feedCursor) {
		await mountEmptyState(list, { titleKey: 'social.empty.feed', modClass: ' empty-state--plain' })
		state.feedShownItems = null
	}
	else if (!append) {
		list.replaceChildren()
		await appendFeedItemsWithThreads(list, visibleItems, buildFeedCardUnlessSuppressed)
		if (feedGeneration !== gen) return
		updateFeedRankingTabs()
	}
	else
		await appendFeedItemsWithThreads(list, visibleItems, buildFeedCardUnlessSuppressed)

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
