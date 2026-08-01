import { bindInfiniteScroll, disconnectInfiniteScroll, ensureScrollSentinel, insertBeforeScrollSentinel } from '/scripts/lib/infiniteScroll.mjs'
import { socialApi } from '../lib/apiClient.mjs'
import { mountEmptyState } from '../lib/emptyState.mjs'
import { buildPostCard } from '../postCard.mjs'
import { activateView } from '../viewChrome.mjs'

let topicGeneration = 0
let currentTopicTag = null

/**
 * @param {HTMLElement} button 关注按钮
 * @param {boolean} isFollowed 是否已关注
 * @returns {void}
 */
function paintTopicFollowButton(button, isFollowed) {
	button.dataset.followed = String(isFollowed)
	button.dataset.i18n = isFollowed ? 'social.topic.unfollow' : 'social.topic.follow'
	button.classList.toggle('btn-primary', !isFollowed)
	button.classList.toggle('btn-outline', isFollowed)
}

/**
 * 初始化话题视图事件绑定（只调用一次）。
 * @returns {void}
 */
export function initTopicView() {
	document.getElementById('topicView')?.addEventListener('click', async event => {
		const followButton = event.target.closest('#topicFollowButton')
		if (!followButton) return
		const tag = followButton.dataset.tag
		if (!tag) return
		const isFollowed = followButton.dataset.followed === 'true'
		try {
			await socialApi('/topics/follow', {
				method: 'POST',
				body: JSON.stringify({ tag, follow: !isFollowed }),
			})
			paintTopicFollowButton(followButton, !isFollowed)
		}
		catch { /* ignore */ }
	})
}

/**
 * 加载话题页。
 * @param {string} tag 话题标签（含或不含 #）
 * @returns {Promise<void>}
 */
export async function loadTopicView(tag) {
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

	const followButton = document.getElementById('topicFollowButton')
	if (followButton) {
		followButton.dataset.tag = normalizedTag
		followButton.className = 'btn btn-primary btn-sm'
		paintTopicFollowButton(followButton, false)
		socialApi('/topics/followed').then(data => {
			const tags = (data.tags || []).map(t => t.toLowerCase())
			const isFollowed = tags.includes(normalizedTag.toLowerCase())
			paintTopicFollowButton(followButton, isFollowed)
		}).catch(() => { })
	}

	await loadTopicPosts(normalizedTag, false)
}

/**
 * @param {string} tag 标签
 * @param {boolean} append 是否追加
 * @returns {Promise<void>}
 */
async function loadTopicPosts(tag, append = false) {
	const view = document.getElementById('topicView')
	if (!view) return
	const gen = ++topicGeneration
	const list = document.getElementById('topicPostList')
	if (!list) return

	const cursor = append ? view.dataset.topicCursor || '' : ''
	const params = new URLSearchParams({ limit: '30' })
	if (cursor) params.set('cursor', cursor)

	const data = await socialApi(`/topics/${encodeURIComponent(tag)}/posts?${params}`).catch(() => ({ items: [] }))
	if (gen !== topicGeneration) return

	const items = data.items || []
	if (!append && !items.length) {
		await mountEmptyState(list, { titleKey: 'social.topic.empty', modClass: ' empty-state--hint' })
		return
	}

	const cards = await Promise.all(items.map(item => buildPostCard(item).catch(() => null)))
	if (gen !== topicGeneration) return

	if (!append) list.replaceChildren(...cards.filter(Boolean))
	else for (const card of cards) if (card) insertBeforeScrollSentinel(list, card)

	view.dataset.topicCursor = data.nextCursor || ''
	if (data.nextCursor) {
		const sentinel = ensureScrollSentinel(list, 'topicScrollSentinel')
		bindInfiniteScroll({
			sentinel,
			/**
			 * @returns {boolean} 是否还有下一页
			 */
			hasMore: () => !!view.dataset.topicCursor,
			/**
			 * @returns {Promise<void>} 加载下一页
			 */
			onLoad: () => loadTopicPosts(currentTopicTag ?? tag, true),
		})
	}
}
