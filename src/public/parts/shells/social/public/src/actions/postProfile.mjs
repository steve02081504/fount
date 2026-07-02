import { refreshQuotePreview } from '../composer.mjs'
import { parseActionKey, queryByActionKey } from '../lib/actionKey.mjs'
import { formatSocialProfileHref } from '/parts/shells:chat/src/lib/socialRunUri.mjs'
import {
	formatChatDmFromSocial,
	formatSocialProfileRunUri,
} from '../lib/runUri.mjs'
import { refreshVisiblePosts, switchView } from '../navigation.mjs'
import { loadExplore } from '../views/explore.mjs'
import { loadProfileFor, renderBlocklist, submitReply } from '../views/profile.mjs'
import { renderRepliesPanel } from '../views/replies.mjs'

import { closePostMoreMenus, copyTextToClipboard } from './shared.mjs'

/**
 * 处理个人资料、关注、拉黑与 Tab 切换相关点击。
 * @param {object} appContext 应用上下文
 * @param {HTMLElement} target 点击目标
 * @returns {Promise<void>}
 */
export async function handleProfileClick(appContext, target) {
	if (target.closest('#saveMetaBtn')) {
		await appContext.socialApi('/profile/meta', {
			method: 'POST',
			body: JSON.stringify({
				exploreBlurb: document.getElementById('exploreBlurbInput')?.value ?? '',
				hideFromDiscovery: document.getElementById('exploreProtectedInput')?.checked ?? false,
			}),
		})
		if (appContext.state.profileEntityHash)
			await loadProfileFor(appContext, appContext.state.profileEntityHash)
	}

	const followBtn = target.closest('[data-follow]')
	if (followBtn instanceof HTMLElement && followBtn.dataset.follow) {
		const entityHash = followBtn.dataset.follow
		const wasFollowing = followBtn.dataset.isFollowing === '1'
		await appContext.socialApi('/relationships/follow', {
			method: 'POST',
			body: JSON.stringify({ entityHash, follow: !wasFollowing }),
		})
		if (appContext.state.profileEntityHash === entityHash)
			await loadProfileFor(appContext, entityHash)
		else
			await loadExplore(appContext)
	}

	const blockBtn = target.closest('[data-block]')
	if (blockBtn instanceof HTMLElement && blockBtn.dataset.block) {
		await appContext.socialApi('/relationships/block', {
			method: 'POST',
			body: JSON.stringify({ entityHash: blockBtn.dataset.block, block: true }),
		})
		await refreshVisiblePosts(appContext)
		closePostMoreMenus()
	}

	const unblockBtn = target.closest('[data-unblock]')
	if (unblockBtn instanceof HTMLElement && unblockBtn.dataset.unblock) {
		await appContext.socialApi('/relationships/block', {
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
		for (const button of document.querySelectorAll('[data-profile-tab]')) {
			button.classList.toggle('active', button.dataset.profileTab === tab)
			button.classList.toggle('tab-active', button.dataset.profileTab === tab)
		}
		for (const panel of document.querySelectorAll('[data-profile-panel]'))
			panel.classList.toggle('hidden', panel.dataset.profilePanel !== tab)
	}
}

/**
 * 处理帖子卡片交互（点赞、转发、回复等）。
 * @param {object} appContext 应用上下文
 * @param {HTMLElement} target 点击目标
 * @returns {Promise<boolean>} 为 true 时表示事件已完全处理，调用方应停止
 */
export async function handlePostClick(appContext, target) {
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

	const moreToggle = target.closest('[data-more-toggle]')
	if (moreToggle instanceof HTMLElement && moreToggle.dataset.moreToggle) {
		const menu = document.querySelector(`[data-more-menu="${moreToggle.dataset.moreToggle}"]`)
		if (menu instanceof HTMLElement) {
			const willOpen = menu.classList.contains('hidden')
			closePostMoreMenus(willOpen ? menu : null)
			menu.classList.toggle('hidden')
		}
		return true
	}

	const likeBtn = target.closest('[data-like]')
	if (likeBtn instanceof HTMLElement && likeBtn.dataset.like) {
		const parsed = parseActionKey(likeBtn.dataset.like)
		if (parsed) {
			const { entityHash, postId } = parsed
			const liked = likeBtn.dataset.liked === '1'
			await appContext.socialApi(`/posts/${entityHash}/${postId}/like`, {
				method: 'POST',
				body: JSON.stringify({ like: !liked }),
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
			await appContext.socialApi(`/posts/${entityHash}/${postId}/repost`, {
				method: 'POST',
				body: JSON.stringify({ comment }),
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
		await appContext.socialApi('/posts', {
			method: 'DELETE',
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
			if (!panel) return false
			panel.classList.toggle('hidden')
			if (panel.dataset.loaded) return false
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
			if (!text) return false
			await submitReply(appContext, entityHash, postId, text)
			textarea.value = ''
			const data = await appContext.socialApi(`/profile/${entityHash}/replies/${postId}`)
			await renderRepliesPanel(appContext, panel, data.replies || [])
			panel.dataset.loaded = '1'
			panel.classList.remove('hidden')
			await refreshVisiblePosts(appContext)
		}
	}

	const translateBtn = target.closest('[data-translate]')
	if (translateBtn instanceof HTMLElement) {
		const cardBody = translateBtn.closest('.post-card')?.querySelector('.body')
		const card = translateBtn.closest('.post-card')
		if (!cardBody || !card) return false
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

	return false
}
