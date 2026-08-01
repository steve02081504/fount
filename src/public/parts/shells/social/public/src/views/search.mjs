import { bindInfiniteScroll, disconnectInfiniteScroll, ensureScrollSentinel, insertBeforeScrollSentinel } from '/scripts/lib/infiniteScroll.mjs'
import { chatApi, socialApi } from '../lib/apiClient.mjs'
import { appendEmptyState, mountEmptyState } from '../lib/emptyState.mjs'
import { buildPostCard } from '../postCard.mjs'
import { state } from '../state.mjs'
import { activateView } from '../viewChrome.mjs'

import { updateFeedSearchChrome } from './feed.mjs'

let searchGeneration = 0

/**
 * @param {HTMLElement} list 容器
 * @param {string} i18nKey 文案键
 * @returns {Promise<void>}
 */
async function showSearchHint(list, i18nKey) {
	await mountEmptyState(list, { titleKey: i18nKey, modClass: ' empty-state--hint' })
}

/**
 * 同步搜索 hash。
 * @param {string} q 查询
 * @returns {void}
 */
function syncSearchHash(q) {
	const next = `#search:${encodeURIComponent(q)}`
	if (location.hash === next) return
	history.replaceState(null, '', `${location.pathname}${location.search}${next}`)
}

/**
 * 纯 hashtag / 侧栏 tag 过滤：不跑实体搜索。
 * @param {string} q 主查询
 * @param {string} tag 侧栏 tag
 * @returns {boolean} 是否跳过实体搜索
 */
function isTagOnlySearch(q, tag) {
	return Boolean(tag) || /^#\w+$/u.test(q)
}

/**
 * 初始化搜索视图事件绑定（只调用一次）。
 * @returns {void}
 */
export function initSearchView() {
	const view = document.getElementById('searchView')
	if (!view) return
	view.querySelector('#searchViewInput')?.addEventListener('keydown', event => {
		if (event.key === 'Enter') void runSearchView()
	})
	view.querySelector('#searchViewButton')?.addEventListener('click', () => void runSearchView())
}

/**
 * 激活搜索视图并可选预填查询词。
 * @param {string} [initialQuery] 初始查询
 * @returns {Promise<void>}
 */
export async function loadSearchView(initialQuery = '') {
	activateView('search')
	const view = document.getElementById('searchView')
	if (!view) return
	const asideInput = document.getElementById('feedSearchInput')
	const input = view.querySelector('#searchViewInput')
	const q = String(initialQuery || '').trim()
		|| (asideInput instanceof HTMLInputElement ? asideInput.value.trim() : '')
		|| (input instanceof HTMLInputElement ? input.value.trim() : '')
	if (input instanceof HTMLInputElement)
		input.value = q
	if (asideInput instanceof HTMLInputElement)
		asideInput.value = q
	state.activeFeedSearchQuery = q || null
	updateFeedSearchChrome()
	if (q)
		await runSearchView()
	else
		input?.focus()
}

/**
 * 执行搜索并渲染结果。
 * @returns {Promise<void>}
 */
export async function runSearchView() {
	const view = document.getElementById('searchView')
	if (!view) return
	const input = view.querySelector('#searchViewInput')
	const q = input instanceof HTMLInputElement ? input.value.trim() : ''
	if (q.length < 2) {
		const list = view.querySelector('#searchViewResults')
		if (list) await showSearchHint(list, 'social.search.tooShort')
		return
	}

	const author = view.querySelector('#searchViewAuthor')?.value?.trim() || ''
	const media = view.querySelector('#searchViewMedia')?.value || ''
	const tag = view.querySelector('#searchViewTag')?.value?.trim() || ''
	const sort = view.querySelector('#searchViewSort')?.value || 'recent'
	const scope = view.querySelector('#searchViewScope')?.value || 'local'

	const gen = ++searchGeneration
	const list = view.querySelector('#searchViewResults')
	if (!list) return

	syncSearchHash(q)
	state.activeFeedSearchQuery = q
	updateFeedSearchChrome()
	const asideInput = document.getElementById('feedSearchInput')
	if (asideInput instanceof HTMLInputElement) asideInput.value = q

	disconnectInfiniteScroll()
	await showSearchHint(list, 'social.search.loading')

	const baseParams = new URLSearchParams({ q, sort, scope, limit: '30' })
	if (author) baseParams.set('author', author)
	if (media) baseParams.set('media', media)
	if (tag) baseParams.set('tag', tag.replace(/^#/, ''))

	const tagOnly = isTagOnlySearch(q, tag)
	const data = await socialApi(`/search?${baseParams}`).catch(() => ({ items: [] }))
	if (gen !== searchGeneration) return

	const items = data.items || []
	list.replaceChildren()

	/** @type {HTMLElement | null} */
	let usersHost = null
	if (!tagOnly) {
		usersHost = document.createElement('div')
		usersHost.className = 'search-users-block'
		list.appendChild(usersHost)
		const usersTitle = document.createElement('h3')
		usersTitle.className = 'section-title'
		usersTitle.dataset.i18n = 'social.search.usersTitle'
		usersHost.appendChild(usersTitle)
	}

	const postsTitle = document.createElement('h3')
	postsTitle.className = 'section-title'
	postsTitle.dataset.i18n = 'social.search.postsTitle'
	list.appendChild(postsTitle)

	if (!items.length)
		await appendEmptyState(list, { titleKey: 'social.search.empty', modClass: ' empty-state--hint' })
	else {
		const cards = await Promise.all(items.map(item => buildPostCard(item).catch(() => null)))
		if (gen !== searchGeneration) return
		for (const card of cards) if (card) list.appendChild(card)
	}

	let cursor = data.nextCursor || null
	if (cursor) {
		const sentinel = ensureScrollSentinel(list, 'searchViewScrollSentinel')
		bindInfiniteScroll({
			sentinel,
			/** @returns {boolean} 是否还有下一页 */
			hasMore: () => !!cursor,
			/** @returns {Promise<void>} */
			onLoad: async () => {
				const p2 = new URLSearchParams(baseParams)
				p2.set('cursor', cursor)
				const d2 = await socialApi(`/search?${p2}`).catch(() => ({ items: [] }))
				if (gen !== searchGeneration) return
				cursor = d2.nextCursor || null
				const c2 = await Promise.all((d2.items || []).map(item => buildPostCard(item).catch(() => null)))
				for (const card of c2) if (card) insertBeforeScrollSentinel(list, card)
			},
		})
	}

	// 实体搜索可能走网络；不阻塞帖子区。纯 hashtag / 侧栏 tag 不跑用户区。
	if (!usersHost) return
	const entityData = await chatApi(`/entities/search?q=${encodeURIComponent(q)}&limit=20`)
		.catch(() => ({ entities: [] }))
	if (gen !== searchGeneration) return
	const entities = entityData.entities || []
	if (!entities.length)
		await appendEmptyState(usersHost, { titleKey: 'social.search.usersEmpty', modClass: ' empty-state--hint' })
	else {
		const { buildEntitySearchCard } = await import('./feed.mjs')
		for (const entity of entities)
			usersHost.appendChild(await buildEntitySearchCard(entity))
	}
}
