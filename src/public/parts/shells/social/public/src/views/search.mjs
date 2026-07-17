import { bindInfiniteScroll, disconnectInfiniteScroll, ensureScrollSentinel } from '/scripts/infiniteScroll.mjs'
import { chatApi, socialApi } from '../lib/apiClient.mjs'
import { buildPostCard } from '../postCard.mjs'
import { socialState } from '../state.mjs'
import { activateView } from '../viewChrome.mjs'

let searchGeneration = 0

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
	socialState.activeFeedSearchQuery = q || null
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
		if (list)
			list.innerHTML = '<p class="empty-hint" data-i18n="social.search.tooShort"></p>'
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
	socialState.activeFeedSearchQuery = q
	const asideInput = document.getElementById('feedSearchInput')
	if (asideInput instanceof HTMLInputElement) asideInput.value = q

	disconnectInfiniteScroll()
	list.innerHTML = '<p class="empty-hint" data-i18n="social.search.loading"></p>'

	const baseParams = new URLSearchParams({ q, sort, scope, limit: '30' })
	if (author) baseParams.set('author', author)
	if (media) baseParams.set('media', media)
	if (tag) baseParams.set('tag', tag.replace(/^#/, ''))

	const [data, entityData] = await Promise.all([
		socialApi(`/search?${baseParams}`).catch(() => ({ items: [] })),
		chatApi(`/entities/search?q=${encodeURIComponent(q)}&limit=20`).catch(() => ({ entities: [] })),
	])
	if (gen !== searchGeneration) return

	const items = data.items || []
	const entities = entityData.entities || []
	list.replaceChildren()

	const usersTitle = document.createElement('h3')
	usersTitle.className = 'section-title'
	usersTitle.dataset.i18n = 'social.search.usersTitle'
	list.appendChild(usersTitle)
	if (!entities.length) {
		const empty = document.createElement('p')
		empty.className = 'empty-hint'
		empty.dataset.i18n = 'social.search.usersEmpty'
		list.appendChild(empty)
	}
	else {
		const { buildEntitySearchCard } = await import('./feed.mjs')
		for (const entity of entities)
			list.appendChild(await buildEntitySearchCard(entity))
	}

	const postsTitle = document.createElement('h3')
	postsTitle.className = 'section-title'
	postsTitle.dataset.i18n = 'social.search.postsTitle'
	list.appendChild(postsTitle)

	if (!items.length) {
		const empty = document.createElement('p')
		empty.className = 'empty-hint'
		empty.dataset.i18n = 'social.search.empty'
		list.appendChild(empty)
		return
	}

	const cards = await Promise.all(items.map(item => buildPostCard(item).catch(() => null)))
	if (gen !== searchGeneration) return
	for (const card of cards) if (card) list.appendChild(card)

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
				for (const card of c2) if (card) list.appendChild(card)
			},
		})
	}
}
