import {
	refreshGroupRefPreview,
	refreshQuotePreview,
	syncGroupRefInComposer,
} from './composer.mjs'
import {
	formatChatDmFromSocial,
	formatSocialProfileHref,
	formatSocialProfileRunUri,
} from './lib/runUri.mjs'
import { refreshVisiblePosts, switchView } from './navigation.mjs'
import { loadExplore } from './views/explore.mjs'
import { clearFeedSearch, loadFeed, runFeedSearch, updateFeedSearchChrome } from './views/feed.mjs'
import { markNotificationsSeen } from './views/notifications.mjs'
import { loadProfileFor, renderBlocklist, submitReply } from './views/profile.mjs'
import { renderRepliesPanel } from './views/replies.mjs'
import { loadSaved, openSaveModal } from './views/saved.mjs'

/**
 * 将文本复制到系统剪贴板（含降级方案）。
 * @param {string} link 文本
 * @returns {Promise<void>}
 */
async function copyTextToClipboard(link) {
	try {
		await navigator.clipboard.writeText(link)
	}
	catch {
		const input = document.createElement('textarea')
		input.value = link
		document.body.appendChild(input)
		input.select()
		document.execCommand('copy')
		input.remove()
	}
}

/**
 * 处理主内容区点击：点赞、转发、收藏、关注等交互委托。
 * @param {object} appContext 应用上下文
 * @param {Event} event 点击事件
 * @returns {Promise<void>}
 */
export async function handleMainClick(appContext, event) {
	const { target } = event
	if (!(target instanceof HTMLElement)) return

	if (target.closest('.clear-quote-btn')) {
		appContext.state.pendingQuoteRef = null
		await refreshQuotePreview(appContext)
	}
	if (target.closest('.clear-group-ref-btn')) {
		appContext.state.pendingGroupRef = null
		syncGroupRefInComposer(appContext, null)
		await refreshGroupRefPreview(appContext)
		const groupSelect = document.getElementById('linkGroupSelect')
		if (groupSelect instanceof HTMLSelectElement)
			groupSelect.value = ''
	}
	if (target.id === 'feedRefreshBtn') {
		appContext.state.activeFeedSearchQuery = null
		const searchInput = document.getElementById('feedSearchInput')
		if (searchInput instanceof HTMLInputElement) searchInput.value = ''
		appContext.state.feedCursor = null
		await loadFeed(appContext, false, { skipSync: true })
		updateFeedSearchChrome(appContext)
	}
	if (target.id === 'feedSearchBtn')
		await runFeedSearch(appContext)
	if (target.id === 'feedSearchClearBtn')
		await clearFeedSearch(appContext)
	if (target.id === 'notificationsMarkAllBtn')
		markNotificationsSeen(appContext)
	if (target.dataset.renameFolder) {
		const name = window.prompt(appContext.geti18n('social.saved.renameFolderPrompt'), '')
		if (!name?.trim()) return
		await appContext.socialApi('/saved-posts/folders/rename', {
			method: 'POST',
			body: JSON.stringify({ folderId: target.dataset.renameFolder, name: name.trim() }),
		})
		await loadSaved(appContext)
	}
	if (target.dataset.deleteFolder) {
		if (!window.confirm(appContext.geti18n('social.saved.deleteFolderConfirm'))) return
		await appContext.socialApi('/saved-posts/folders/delete', {
			method: 'POST',
			body: JSON.stringify({ folderId: target.dataset.deleteFolder }),
		})
		await loadSaved(appContext)
	}
	if (target.dataset.copyLink) {
		const [entityHash, postId] = target.dataset.copyLink.split(':')
		const runUri = formatSocialProfileRunUri(entityHash, postId)
		const pageUrl = `${window.location.origin}${formatSocialProfileHref(entityHash, postId)}`
		await copyTextToClipboard(`${runUri}\n${pageUrl}`)
		target.textContent = appContext.geti18n('social.actions.copied')
		setTimeout(() => { target.textContent = appContext.geti18n('social.actions.copyLink') }, 1500)
	}
	if (target.id === 'saveMetaBtn') {
		await appContext.socialApi('/profile/meta', {
			method: 'POST',
			body: JSON.stringify({
				exploreBlurb: document.getElementById('exploreBlurbInput')?.value ?? '',
				isProtected: document.getElementById('exploreProtectedInput')?.checked ?? false,
			}),
		})
		if (appContext.state.profileEntityHash)
			await loadProfileFor(appContext, appContext.state.profileEntityHash)
	}
	if (target.id === 'createFolderBtn') {
		const name = document.getElementById('newFolderName')?.value.trim()
		if (!name) return
		await appContext.socialApi('/saved-posts/folders', { method: 'POST', body: JSON.stringify({ name }) })
		await loadSaved(appContext)
	}
	if (target.dataset.follow) {
		const entityHash = target.dataset.follow
		const wasFollowing = target.dataset.isFollowing === '1'
		await appContext.socialApi('/profile/follow', {
			method: 'POST',
			body: JSON.stringify({ entityHash, follow: !wasFollowing }),
		})
		if (appContext.state.profileEntityHash === entityHash)
			await loadProfileFor(appContext, entityHash)
		else
			await loadExplore(appContext)
	}
	if (target.dataset.like) {
		const [entityHash, postId] = target.dataset.like.split(':')
		const liked = target.dataset.liked === '1'
		await appContext.socialApi('/profile/like', {
			method: 'POST',
			body: JSON.stringify({ entityHash, postId, like: !liked }),
		})
		await refreshVisiblePosts(appContext)
	}
	if (target.dataset.repost) {
		const [entityHash, postId] = target.dataset.repost.split(':')
		document.querySelector(`[data-repost-for="${entityHash}:${postId}"]`)?.classList.toggle('hidden')
	}
	if (target.dataset.submitRepost) {
		const [entityHash, postId] = target.dataset.submitRepost.split(':')
		const panel = document.querySelector(`[data-repost-for="${entityHash}:${postId}"]`)
		const textarea = panel?.querySelector('textarea')
		const comment = textarea?.value.trim() || ''
		await appContext.socialApi('/profile/repost', {
			method: 'POST',
			body: JSON.stringify({ entityHash, postId, comment }),
		})
		if (textarea) textarea.value = ''
		panel?.classList.add('hidden')
		await refreshVisiblePosts(appContext)
	}
	if (target.dataset.quote) {
		const [entityHash, postId] = target.dataset.quote.split(':')
		const card = target.closest('.post-card')
		const text = decodeURIComponent(card?.dataset.postText || '')
		appContext.state.pendingQuoteRef = { entityHash, postId, text }
		refreshQuotePreview(appContext)
		if (document.getElementById('composer')?.classList.contains('hidden'))
			await switchView(appContext, 'feed')
		document.getElementById('composer')?.scrollIntoView({ behavior: 'smooth' })
		document.getElementById('postText')?.focus()
	}
	if (target.dataset.delete) {
		await appContext.socialApi('/profile/post-delete', {
			method: 'POST',
			body: JSON.stringify({ postId: target.dataset.delete }),
		})
		await refreshVisiblePosts(appContext)
	}
	if (target.dataset.replies) {
		const [entityHash, postId] = target.dataset.replies.split(':')
		const panel = document.querySelector(`[data-replies-for="${entityHash}:${postId}"]`)
		if (!panel) return
		panel.classList.toggle('hidden')
		panel.dataset.repliesFor = `${entityHash}:${postId}`
		if (panel.dataset.loaded) return
		const data = await appContext.socialApi(`/profile/${entityHash}/replies/${postId}`)
		await renderRepliesPanel(appContext, panel, data.replies || [])
		panel.dataset.loaded = '1'
	}
	if (target.dataset.submitReply) {
		const [entityHash, postId] = target.dataset.submitReply.split(':')
		const panel = document.querySelector(`[data-replies-for="${entityHash}:${postId}"]`)
		const textarea = panel?.querySelector('textarea')
		const text = textarea?.value.trim()
		if (!text) return
		await submitReply(appContext, entityHash, postId, text)
		textarea.value = ''
		const data = await appContext.socialApi(`/profile/${entityHash}/replies/${postId}`)
		await renderRepliesPanel(appContext, panel, data.replies || [])
		panel.dataset.loaded = '1'
		panel.classList.remove('hidden')
		await refreshVisiblePosts(appContext)
	}
	if (target.dataset.save) {
		const [entityHash, postId] = target.dataset.save.split(':')
		await openSaveModal(appContext, entityHash, postId, target)
	}
	if (target.dataset.removeSaved) {
		const [entityHash, postId] = target.dataset.removeSaved.split(':')
		const folderId = target.dataset.savedFolder || undefined
		await appContext.socialApi('/saved-posts/remove', {
			method: 'POST',
			body: JSON.stringify({
				entityHash,
				postId,
				...folderId ? { folderId } : {},
			}),
		})
		await loadSaved(appContext)
	}
	if (target.dataset.translate) {
		const cardBody = target.closest('.post-card')?.querySelector('.body')
		const card = target.closest('.post-card')
		if (!cardBody || !card) return
		const text = decodeURIComponent(card.dataset.postText || '')
		const result = await appContext.socialApi('/translate', {
			method: 'POST',
			body: JSON.stringify({ text, targetLang: 'zh-CN' }),
		})
		const block = document.createElement('div')
		block.className = 'translation-block'
		block.innerHTML = `<strong>${appContext.geti18n('social.translate.label')}</strong> ${result.translated}`
		cardBody.appendChild(block)
	}
	if (target.dataset.block) {
		await appContext.socialApi('/profile/block', {
			method: 'POST',
			body: JSON.stringify({ entityHash: target.dataset.block, block: true }),
		})
		await refreshVisiblePosts(appContext)
	}
	if (target.dataset.unblock) {
		await appContext.socialApi('/profile/block', {
			method: 'POST',
			body: JSON.stringify({ entityHash: target.dataset.unblock, block: false }),
		})
		await renderBlocklist(appContext, document.getElementById('blocklistSection'))
	}
	if (target.dataset.dm)
		window.location.href = formatChatDmFromSocial(target.dataset.dm)
}
