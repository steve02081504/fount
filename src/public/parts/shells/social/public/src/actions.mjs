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
	const deleteFolderBtn = target.closest('[data-delete-folder]')
	if (deleteFolderBtn instanceof HTMLElement && deleteFolderBtn.dataset.deleteFolder) {
		if (!window.confirm(appContext.geti18n('social.saved.deleteFolderConfirm'))) return
		await appContext.socialApi('/saved-posts/folders/delete', {
			method: 'POST',
			body: JSON.stringify({ folderId: deleteFolderBtn.dataset.deleteFolder }),
		})
		await loadSaved(appContext)
	}
	const copyLinkBtn = target.closest('[data-copy-link]')
	if (copyLinkBtn instanceof HTMLElement && copyLinkBtn.dataset.copyLink) {
		const [entityHash, postId] = copyLinkBtn.dataset.copyLink.split(':')
		const runUri = formatSocialProfileRunUri(entityHash, postId)
		const pageUrl = `${window.location.origin}${formatSocialProfileHref(entityHash, postId)}`
		await copyTextToClipboard(`${runUri}\n${pageUrl}`)
		copyLinkBtn.textContent = appContext.geti18n('social.actions.copied')
		setTimeout(() => { copyLinkBtn.textContent = appContext.geti18n('social.actions.copyLink') }, 1500)
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
	const followBtn = target.closest('[data-follow]')
	if (followBtn instanceof HTMLElement && followBtn.dataset.follow) {
		const entityHash = followBtn.dataset.follow
		const wasFollowing = followBtn.dataset.isFollowing === '1'
		await appContext.socialApi('/profile/follow', {
			method: 'POST',
			body: JSON.stringify({ entityHash, follow: !wasFollowing }),
		})
		if (appContext.state.profileEntityHash === entityHash)
			await loadProfileFor(appContext, entityHash)
		else
			await loadExplore(appContext)
	}
	const likeBtn = target.closest('[data-like]')
	if (likeBtn instanceof HTMLElement && likeBtn.dataset.like) {
		const [entityHash, postId] = likeBtn.dataset.like.split(':')
		const liked = likeBtn.dataset.liked === '1'
		await appContext.socialApi('/profile/like', {
			method: 'POST',
			body: JSON.stringify({ entityHash, postId, like: !liked }),
		})
		await refreshVisiblePosts(appContext)
	}
	const repostBtn = target.closest('[data-repost]')
	if (repostBtn instanceof HTMLElement && repostBtn.dataset.repost) {
		const [entityHash, postId] = repostBtn.dataset.repost.split(':')
		document.querySelector(`[data-repost-for="${entityHash}:${postId}"]`)?.classList.toggle('hidden')
	}
	const submitRepostBtn = target.closest('[data-submit-repost]')
	if (submitRepostBtn instanceof HTMLElement && submitRepostBtn.dataset.submitRepost) {
		const [entityHash, postId] = submitRepostBtn.dataset.submitRepost.split(':')
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
	const quoteBtn = target.closest('[data-quote]')
	if (quoteBtn instanceof HTMLElement && quoteBtn.dataset.quote) {
		const [entityHash, postId] = quoteBtn.dataset.quote.split(':')
		const card = quoteBtn.closest('.post-card')
		const text = decodeURIComponent(card?.dataset.postText || '')
		appContext.state.pendingQuoteRef = { entityHash, postId, text }
		await refreshQuotePreview(appContext)
		if (document.getElementById('composer')?.classList.contains('hidden'))
			await switchView(appContext, 'feed')
		document.getElementById('composer')?.scrollIntoView({ behavior: 'smooth' })
		document.getElementById('postText')?.focus()
	}
	const deleteBtn = target.closest('button[data-delete]')
	if (deleteBtn instanceof HTMLElement && deleteBtn.dataset.delete) {
		await appContext.socialApi('/profile/post-delete', {
			method: 'POST',
			body: JSON.stringify({ postId: deleteBtn.dataset.delete }),
		})
		await refreshVisiblePosts(appContext)
	}
	const repliesBtn = target.closest('[data-replies]')
	if (repliesBtn instanceof HTMLElement && repliesBtn.dataset.replies) {
		const [entityHash, postId] = repliesBtn.dataset.replies.split(':')
		const panel = document.querySelector(`[data-replies-for="${entityHash}:${postId}"]`)
		if (!panel) return
		panel.classList.toggle('hidden')
		panel.dataset.repliesFor = `${entityHash}:${postId}`
		if (panel.dataset.loaded) return
		const data = await appContext.socialApi(`/profile/${entityHash}/replies/${postId}`)
		await renderRepliesPanel(appContext, panel, data.replies || [])
		panel.dataset.loaded = '1'
	}
	const submitReplyBtn = target.closest('[data-submit-reply]')
	if (submitReplyBtn instanceof HTMLElement && submitReplyBtn.dataset.submitReply) {
		const [entityHash, postId] = submitReplyBtn.dataset.submitReply.split(':')
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
	const saveBtn = target.closest('[data-save]')
	if (saveBtn instanceof HTMLElement && saveBtn.dataset.save) {
		const actionKey = saveBtn.dataset.save
		const sep = actionKey.lastIndexOf(':')
		if (sep < 0) return
		const entityHash = actionKey.slice(0, sep)
		const postId = actionKey.slice(sep + 1)
		await openSaveModal(appContext, entityHash, postId, saveBtn)
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
