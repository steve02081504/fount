import { formatActionKey } from '../lib/actionKey.mjs'
import { socialApi } from '../lib/apiClient.mjs'
import { rememberEntityHandle } from '../lib/display.mjs'
import { buildPostCard } from '../postCard.mjs'
import { state } from '../state.mjs'
import { activateView } from '../viewChrome.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'

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
	container.innerHTML = `<div class="post-detail-loading">${escapeHtml(geti18n('social.post.loading'))}</div>`

	let data
	try {
		data = await socialApi(`/posts/${owner}/${id}`)
	}
	catch (error) {
		const msg = String(error?.message || '')
		const notFound = /post not found/i.test(msg)
		container.innerHTML = `<div class="empty">${escapeHtml(geti18n(notFound ? 'social.post.notFound' : 'social.post.loadFailed'))}</div>`
		return
	}
	if (!data?.item) {
		container.innerHTML = `<div class="empty">${escapeHtml(geti18n('social.post.notFound'))}</div>`
		return
	}

	const profileData = await socialApi(`/profile/${owner}`).catch(() => null)
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
		<button type="button" class="btn btn-ghost btn-sm" data-post-detail-back>${escapeHtml(geti18n('social.post.back'))}</button>
		<h2 class="view-title">${escapeHtml(geti18n('social.post.detailTitle'))}</h2>
	`
	header.querySelector('[data-post-detail-back]')?.addEventListener('click', () => {
		history.back()
	})
	container.appendChild(header)
	container.appendChild(card)
	container.appendChild(repliesHost)

	const { bindFeedVideoAutoplay } = await import('../lib/videoAutoplay.mjs')
	bindFeedVideoAutoplay(card)

	const repliesData = await socialApi(`/profile/${owner}/replies/${id}`).catch(() => ({ replies: [] }))
	await renderRepliesPanel(repliesHost, repliesData.replies || [])
	repliesHost.dataset.loaded = '1'
	repliesHost.classList.remove('hidden')
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
