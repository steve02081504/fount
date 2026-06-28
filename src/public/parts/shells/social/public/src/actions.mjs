import {
	refreshGroupRefPreview,
	refreshQuotePreview,
	syncGroupRefInComposer,
} from './composer.mjs'
import { parseActionKey, queryByActionKey } from './lib/actionKey.mjs'
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
 * 关闭所有帖子溢出菜单（可选排除某一菜单）。
 * @param {HTMLElement | null} [exceptMenu] 保留打开的菜单
 * @returns {void}
 */
function closePostMoreMenus(exceptMenu = null) {
	for (const menu of document.querySelectorAll('.post-more-menu'))
		if (menu !== exceptMenu)
			menu.classList.add('hidden')
}

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

	if (!target.closest('.post-more-dropdown'))
		closePostMoreMenus()

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
	if (target.closest('#feedRefreshBtn')) {
		appContext.state.activeFeedSearchQuery = null
		const searchInput = document.getElementById('feedSearchInput')
		if (searchInput instanceof HTMLInputElement) searchInput.value = ''
		appContext.state.feedCursor = null
		await loadFeed(appContext, false, { skipSync: true })
		updateFeedSearchChrome(appContext)
	}
	if (target.closest('#feedSearchBtn'))
		await runFeedSearch(appContext)
	if (target.closest('#feedSearchClearBtn'))
		await clearFeedSearch(appContext)
	if (target.closest('#notificationsMarkAllBtn'))
		markNotificationsSeen(appContext)

	const renameFolderBtn = target.closest('[data-rename-folder]')
	if (renameFolderBtn instanceof HTMLElement && renameFolderBtn.dataset.renameFolder) {
		const name = window.prompt(appContext.geti18n('social.saved.renameFolderPrompt'), '')
		if (!name?.trim()) return
		await appContext.socialApi('/saved-posts/folders/rename', {
			method: 'POST',
			body: JSON.stringify({ folderId: renameFolderBtn.dataset.renameFolder, name: name.trim() }),
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
		const parsed = parseActionKey(copyLinkBtn.dataset.copyLink)
		if (parsed) {
			const { entityHash, postId } = parsed
			const runUri = formatSocialProfileRunUri(entityHash, postId)
			const pageUrl = `${window.location.origin}${formatSocialProfileHref(entityHash, postId)}`
			await copyTextToClipboard(`${runUri}\n${pageUrl}`)
			const label = copyLinkBtn.querySelector('[data-i18n="social.actions.copyLink"]')
			if (label) label.textContent = appContext.geti18n('social.actions.copied')
			setTimeout(() => {
				if (label) label.textContent = appContext.geti18n('social.actions.copyLink')
			}, 1500)
			closePostMoreMenus()
		}
	}

	if (target.closest('#saveMetaBtn')) {
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
	if (target.closest('#createFolderBtn')) {
		const name = document.getElementById('newFolderName')?.value.trim()
		if (!name) return
		await appContext.socialApi('/saved-posts/folders', { method: 'POST', body: JSON.stringify({ name }) })
		await loadSaved(appContext)
	}

	const moreToggle = target.closest('[data-more-toggle]')
	if (moreToggle instanceof HTMLElement && moreToggle.dataset.moreToggle) {
		const menu = document.querySelector(`[data-more-menu="${moreToggle.dataset.moreToggle}"]`)
		if (menu instanceof HTMLElement) {
			const willOpen = menu.classList.contains('hidden')
			closePostMoreMenus(willOpen ? menu : null)
			menu.classList.toggle('hidden')
		}
		return
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
		const parsed = parseActionKey(likeBtn.dataset.like)
		if (parsed) {
			const { entityHash, postId } = parsed
			const liked = likeBtn.dataset.liked === '1'
			await appContext.socialApi('/profile/like', {
				method: 'POST',
				body: JSON.stringify({ entityHash, postId, like: !liked }),
			})
			await refreshVisiblePosts(appContext)
		}
	}

	const repostBtn = target.closest('[data-repost]')
	if (repostBtn instanceof HTMLElement && repostBtn.dataset.repost)
		queryByActionKey('data-repost-for', repostBtn.dataset.repost)?.classList.toggle('hidden')

	const submitRepostBtn = target.closest('[data-submit-repost]')
	if (submitRepostBtn instanceof HTMLElement && submitRepostBtn.dataset.submitRepost) {
		const actionKey = submitRepostBtn.dataset.submitRepost
		const panel = queryByActionKey('data-repost-for', actionKey)
		const textarea = panel?.querySelector('textarea')
		const comment = textarea?.value.trim() || ''
		const parsed = parseActionKey(actionKey)
		if (parsed) {
			const { entityHash, postId } = parsed
			await appContext.socialApi('/profile/repost', {
				method: 'POST',
				body: JSON.stringify({ entityHash, postId, comment }),
			})
			if (textarea) textarea.value = ''
			panel?.classList.add('hidden')
			await refreshVisiblePosts(appContext)
		}
	}

	const quoteBtn = target.closest('[data-quote]')
	if (quoteBtn instanceof HTMLElement && quoteBtn.dataset.quote) {
		const parsed = parseActionKey(quoteBtn.dataset.quote)
		if (parsed) {
			const { entityHash, postId } = parsed
			const card = quoteBtn.closest('.post-card')
			const text = decodeURIComponent(card?.dataset.postText || '')
			appContext.state.pendingQuoteRef = { entityHash, postId, text }
			await refreshQuotePreview(appContext)
			if (document.getElementById('composer')?.classList.contains('hidden'))
				await switchView(appContext, 'feed')
			document.getElementById('composer')?.scrollIntoView({ behavior: 'smooth' })
			document.getElementById('postText')?.focus()
			closePostMoreMenus()
		}
	}

	const deleteBtn = target.closest('button[data-delete]')
	if (deleteBtn instanceof HTMLElement && deleteBtn.dataset.delete) {
		await appContext.socialApi('/profile/post-delete', {
			method: 'POST',
			body: JSON.stringify({ postId: deleteBtn.dataset.delete }),
		})
		await refreshVisiblePosts(appContext)
		closePostMoreMenus()
	}

	const repliesBtn = target.closest('[data-replies]')
	if (repliesBtn instanceof HTMLElement && repliesBtn.dataset.replies) {
		const actionKey = repliesBtn.dataset.replies
		const parsed = parseActionKey(actionKey)
		if (parsed) {
			const { entityHash, postId } = parsed
			const panel = queryByActionKey('data-replies-for', actionKey)
			if (!panel) return
			panel.classList.toggle('hidden')
			if (panel.dataset.loaded) return
			const data = await appContext.socialApi(`/profile/${entityHash}/replies/${postId}`)
			await renderRepliesPanel(appContext, panel, data.replies || [])
			panel.dataset.loaded = '1'
		}
	}

	const submitReplyBtn = target.closest('[data-submit-reply]')
	if (submitReplyBtn instanceof HTMLElement && submitReplyBtn.dataset.submitReply) {
		const actionKey = submitReplyBtn.dataset.submitReply
		const parsed = parseActionKey(actionKey)
		if (parsed) {
			const { entityHash, postId } = parsed
			const panel = queryByActionKey('data-replies-for', actionKey)
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
	}

	const saveBtn = target.closest('[data-save]')
	if (saveBtn instanceof HTMLElement && saveBtn.dataset.save) {
		const parsed = parseActionKey(saveBtn.dataset.save)
		if (parsed)
			await openSaveModal(appContext, parsed.entityHash, parsed.postId, saveBtn)
	}

	const removeSavedBtn = target.closest('[data-remove-saved]')
	if (removeSavedBtn instanceof HTMLElement && removeSavedBtn.dataset.removeSaved) {
		const parsed = parseActionKey(removeSavedBtn.dataset.removeSaved)
		if (parsed) {
			const { entityHash, postId } = parsed
			const folderId = removeSavedBtn.dataset.savedFolder || undefined
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
	}

	const translateBtn = target.closest('[data-translate]')
	if (translateBtn instanceof HTMLElement) {
		const cardBody = translateBtn.closest('.post-card')?.querySelector('.body')
		const card = translateBtn.closest('.post-card')
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
		closePostMoreMenus()
	}

	const blockBtn = target.closest('[data-block]')
	if (blockBtn instanceof HTMLElement && blockBtn.dataset.block) {
		await appContext.socialApi('/profile/block', {
			method: 'POST',
			body: JSON.stringify({ entityHash: blockBtn.dataset.block, block: true }),
		})
		await refreshVisiblePosts(appContext)
		closePostMoreMenus()
	}

	const unblockBtn = target.closest('[data-unblock]')
	if (unblockBtn instanceof HTMLElement && unblockBtn.dataset.unblock) {
		await appContext.socialApi('/profile/block', {
			method: 'POST',
			body: JSON.stringify({ entityHash: unblockBtn.dataset.unblock, block: false }),
		})
		await renderBlocklist(appContext, document.getElementById('blocklistSection'))
	}

	const dmBtn = target.closest('[data-dm]')
	if (dmBtn instanceof HTMLElement && dmBtn.dataset.dm)
		window.location.href = formatChatDmFromSocial(dmBtn.dataset.dm)

	const profileTab = target.closest('[data-profile-tab]')
	if (profileTab instanceof HTMLElement && profileTab.dataset.profileTab) {
		const tab = profileTab.dataset.profileTab
		for (const button of document.querySelectorAll('[data-profile-tab]'))
			button.classList.toggle('active', button.dataset.profileTab === tab)
		for (const button of document.querySelectorAll('[data-profile-tab]'))
			button.classList.toggle('tab-active', button.dataset.profileTab === tab)
		for (const panel of document.querySelectorAll('[data-profile-panel]'))
			panel.classList.toggle('hidden', panel.dataset.profilePanel !== tab)
	}
}
