import { bindInfiniteScroll, disconnectInfiniteScroll, ensureScrollSentinel } from '/scripts/infiniteScroll.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { activateView } from '../viewChrome.mjs'

let topicGeneration = 0
let currentTopicTag = null

/**
 * 初始化话题视图事件绑定（只调用一次）。
 * @param {object} appContext 应用上下文
 * @returns {void}
 */
export function initTopicView(appContext) {
	document.getElementById('topicView')?.addEventListener('click', async event => {
		const btn = event.target.closest('#topicFollowButton')
		if (!btn) return
		const tag = btn.dataset.tag
		if (!tag) return
		const isFollowed = btn.dataset.followed === 'true'
		try {
			await appContext.socialApi('/topics/follow', {
				method: 'POST',
				body: JSON.stringify({ tag, follow: !isFollowed }),
			})
			btn.dataset.followed = String(!isFollowed)
			btn.textContent = appContext.geti18n(!isFollowed ? 'social.topic.unfollow' : 'social.topic.follow')
			btn.classList.toggle('btn-primary', isFollowed)
			btn.classList.toggle('btn-outline', !isFollowed)
		}
		catch { /* ignore */ }
	})
}

/**
 * 加载话题页。
 * @param {object} appContext 应用上下文
 * @param {string} tag 话题标签（含或不含 #）
 * @returns {Promise<void>}
 */
export async function loadTopicView(appContext, tag) {
	activateView('topic')
	const view = document.getElementById('topicView')
	if (!view) return

	const normalizedTag = String(tag || '').replace(/^#/, '').trim()
	currentTopicTag = normalizedTag

	const titleEl = view.querySelector('.topic-view-title')
	if (titleEl) titleEl.textContent = `#${normalizedTag}`

	disconnectInfiniteScroll()
	const list = document.getElementById('topicPostList')
	if (list) list.replaceChildren()
	delete view.dataset.topicCursor

	// 检查订阅状态
	const followBtn = document.getElementById('topicFollowButton')
	if (followBtn) {
		followBtn.dataset.tag = normalizedTag
		followBtn.dataset.followed = 'false'
		followBtn.textContent = appContext.geti18n('social.topic.follow')
		followBtn.className = 'btn btn-primary btn-sm'
		appContext.socialApi('/topics/followed').then(data => {
			const tags = (data.tags || []).map(t => t.toLowerCase())
			const isFollowed = tags.includes(normalizedTag.toLowerCase())
			followBtn.dataset.followed = String(isFollowed)
			followBtn.textContent = appContext.geti18n(isFollowed ? 'social.topic.unfollow' : 'social.topic.follow')
			followBtn.classList.toggle('btn-primary', !isFollowed)
			followBtn.classList.toggle('btn-outline', isFollowed)
		}).catch(() => {})
	}

	await loadTopicPosts(appContext, normalizedTag, false)
}

/**
 * @param {object} appContext 应用上下文
 * @param {string} tag 标签
 * @param {boolean} append 是否追加
 * @returns {Promise<void>}
 */
async function loadTopicPosts(appContext, tag, append = false) {
	const view = document.getElementById('topicView')
	if (!view) return
	const gen = ++topicGeneration
	const list = document.getElementById('topicPostList')
	if (!list) return

	const cursor = append ? (view.dataset.topicCursor || '') : ''
	const params = new URLSearchParams({ limit: '30' })
	if (cursor) params.set('cursor', cursor)

	const data = await appContext.socialApi(`/topics/${encodeURIComponent(tag)}/posts?${params}`).catch(() => ({ items: [] }))
	if (gen !== topicGeneration) return

	const items = data.items || []
	if (!append && !items.length) {
		list.innerHTML = `<p class="empty-hint">${escapeHtml(appContext.geti18n('social.topic.empty'))}</p>`
		return
	}

	const cards = await Promise.all(items.map(item => appContext.buildPostCard(item).catch(() => null)))
	if (gen !== topicGeneration) return

	if (!append) list.replaceChildren(...cards.filter(Boolean))
	else for (const card of cards) if (card) list.appendChild(card)

	view.dataset.topicCursor = data.nextCursor || ''
	if (data.nextCursor) {
		const sentinel = ensureScrollSentinel(list, 'topicScrollSentinel')
		bindInfiniteScroll({
			sentinel,
			hasMore: () => !!view.dataset.topicCursor,
			onLoad: () => loadTopicPosts(appContext, currentTopicTag ?? tag, true),
		})
	}
}
