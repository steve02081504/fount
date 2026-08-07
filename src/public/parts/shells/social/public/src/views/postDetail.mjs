import { getPost } from '../endpoints/posts.mjs'
import { getProfile, getProfileReplies } from '../endpoints/profile.mjs'
import { formatActionKey } from '../lib/actionKey.mjs'
import { rememberEntityHandle } from '../lib/display.mjs'
import { mountEmptyState } from '../lib/emptyState.mjs'
import { buildPostCard } from '../postCard.mjs'
import { state } from '../state.mjs'
import { activateView } from '../viewChrome.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'

import { renderRepliesPanel } from './replies.mjs'

/**
 * 打开并渲染单帖详情页。
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @returns {Promise<void>}
 */
export async function loadPostDetail(entityHash, postId) {
	const owner = String(entityHash || '').toLowerCase()
	const id = String(postId || '')
	state.postDetailEntityHash = owner
	state.postDetailPostId = id
	activateView('postDetail')
	document.getElementById('composer')?.classList.add('hidden')
	const hash = `post;${owner};${id}`
	if (location.hash.replace(/^#/, '') !== hash)
		history.replaceState(null, '', `${location.pathname}${location.search}#${hash}`)

	const container = document.getElementById('postDetailView')
	if (!container) return
	container.innerHTML = '<div class="post-detail-loading" data-i18n="social.post.loading"></div>'

	let data
	try {
		data = await getPost(owner, id)
	}
	catch (error) {
		const msg = String(error?.message || '')
		const key = /post not found/i.test(msg) ? 'social.post.notFound' : 'social.post.loadFailed'
		container.innerHTML = `<div class="empty" data-i18n="${key}"></div>`
		return
	}
	if (!data?.item) {
		container.innerHTML = '<div class="empty" data-i18n="social.post.notFound"></div>'
		return
	}

	let profileData
	try {
		profileData = await getProfile(owner)
	}
	catch {
		profileData = null
	}
	rememberEntityHandle(owner, profileData?.profile || data.item.authorProfile)

	const card = await buildPostCard(data.item, { openDetail: false })
	card.classList.add('post-detail-card')
	const repliesHost = document.createElement('div')
	repliesHost.className = 'post-detail-replies'
	const actionKey = formatActionKey(owner, id)
	repliesHost.dataset.repliesFor = actionKey

	container.replaceChildren()
	const header = document.createElement('header')
	header.className = 'view-header post-detail-header'
	header.innerHTML = `
		<button type="button" class="btn btn-ghost btn-sm" data-post-detail-back data-i18n="social.post.back"></button>
		<h2 class="view-title" data-i18n="social.post.detailTitle"></h2>
	`
	header.querySelector('[data-post-detail-back]')?.addEventListener('click', () => {
		history.back()
	})
	container.appendChild(header)
	container.appendChild(card)
	container.appendChild(repliesHost)

	const { bindFeedVideoAutoplay } = await import('../lib/videoAutoplay.mjs')
	bindFeedVideoAutoplay(card)

	try {
		const repliesData = await getProfileReplies(owner, id)
		await renderRepliesPanel(repliesHost, repliesData.replies || [])
		repliesHost.dataset.loaded = '1'
		repliesHost.classList.remove('hidden')
	}
	catch (error) {
		handleError('social.replies.loadFailed', {}, error)
		await mountEmptyState(repliesHost, {
			titleKey: 'social.replies.loadFailed',
			modClass: ' empty-state--replies',
		})
	}
	// 详情页默认展开回复，隐藏卡片内嵌的折叠面板触发依赖
	card.querySelector(`[data-replies-for="${CSS.escape(actionKey)}"]`)?.remove()
}

/**
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @returns {void}
 */
export function navigateToPostDetail(entityHash, postId) {
	location.hash = `post;${entityHash};${postId}`
}
