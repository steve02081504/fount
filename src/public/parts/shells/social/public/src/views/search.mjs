import { bindInfiniteScroll, disconnectInfiniteScroll, ensureScrollSentinel } from '/scripts/infiniteScroll.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { activateView } from '../viewChrome.mjs'

let searchGeneration = 0

/**
 * 初始化搜索视图事件绑定（只调用一次）。
 * @param {object} appContext 应用上下文
 * @returns {void}
 */
export function initSearchView(appContext) {
	const view = document.getElementById('searchView')
	if (!view) return
	view.querySelector('#searchViewInput')?.addEventListener('keydown', event => {
		if (event.key === 'Enter') void runSearchView(appContext)
	})
	view.querySelector('#searchViewButton')?.addEventListener('click', () => void runSearchView(appContext))
}

/**
 * 激活搜索视图并可选预填查询词。
 * @param {object} appContext 应用上下文
 * @param {string} [initialQuery] 初始查询
 * @returns {Promise<void>}
 */
export async function loadSearchView(appContext, initialQuery = '') {
	activateView('search')
	const view = document.getElementById('searchView')
	if (!view) return
	const input = view.querySelector('#searchViewInput')
	if (input instanceof HTMLInputElement && initialQuery)
		input.value = initialQuery
	if (initialQuery)
		await runSearchView(appContext)
	else
		input?.focus()
}

/**
 * 执行搜索并渲染结果。
 * @param {object} appContext 应用上下文
 * @returns {Promise<void>}
 */
export async function runSearchView(appContext) {
	const view = document.getElementById('searchView')
	if (!view) return
	const input = view.querySelector('#searchViewInput')
	const q = input instanceof HTMLInputElement ? input.value.trim() : ''
	if (q.length < 2) return

	const author = view.querySelector('#searchViewAuthor')?.value?.trim() || ''
	const media = view.querySelector('#searchViewMedia')?.value || ''
	const tag = view.querySelector('#searchViewTag')?.value?.trim() || ''
	const sort = view.querySelector('#searchViewSort')?.value || 'recent'
	const scope = view.querySelector('#searchViewScope')?.value || 'local'

	const gen = ++searchGeneration
	const list = view.querySelector('#searchViewResults')
	if (!list) return

	disconnectInfiniteScroll()
	list.innerHTML = `<p class="empty-hint">${escapeHtml(appContext.geti18n('social.search.loading'))}</p>`

	const baseParams = new URLSearchParams({ q, sort, scope, limit: '30' })
	if (author) baseParams.set('author', author)
	if (media) baseParams.set('media', media)
	if (tag) baseParams.set('tag', tag.replace(/^#/, ''))

	const data = await appContext.socialApi(`/search?${baseParams}`).catch(() => ({ items: [] }))
	if (gen !== searchGeneration) return

	const items = data.items || []
	if (!items.length) {
		list.innerHTML = `<p class="empty-hint">${escapeHtml(appContext.geti18n('social.search.empty'))}</p>`
		return
	}

	const cards = await Promise.all(items.map(item => appContext.buildPostCard(item).catch(() => null)))
	if (gen !== searchGeneration) return

	list.replaceChildren(...cards.filter(Boolean))

	let cursor = data.nextCursor || null
	if (cursor) {
		const sentinel = ensureScrollSentinel(list, 'searchViewScrollSentinel')
		bindInfiniteScroll({
			sentinel,
			hasMore: () => !!cursor,
			onLoad: async () => {
				const p2 = new URLSearchParams(baseParams)
				p2.set('cursor', cursor)
				const d2 = await appContext.socialApi(`/search?${p2}`).catch(() => ({ items: [] }))
				if (gen !== searchGeneration) return
				cursor = d2.nextCursor || null
				const c2 = await Promise.all((d2.items || []).map(item => appContext.buildPostCard(item).catch(() => null)))
				for (const card of c2) if (card) list.appendChild(card)
			},
		})
	}
}
