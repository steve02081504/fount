import { renderTemplate } from '/scripts/features/template.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { refreshQuotePreview } from '../composer.mjs'
import { parseActionKey, queryByActionKey } from '../lib/actionKey.mjs'
import { refreshVisiblePosts, switchView } from '../navigation.mjs'
import { submitReply } from '../views/profile.mjs'
import { renderRepliesPanel } from '../views/replies.mjs'

import { closePostMoreMenus } from './shared.mjs'

/**
 * @param {object} appContext Social 应用上下文
 * @param {HTMLElement} target 点击目标元素
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handlePostEngagementClick(appContext, target) {
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
		const block = await renderTemplate('translate_block', {
			translated: escapeHtml(result.translated),
		})
		cardBody.appendChild(block)
		closePostMoreMenus()
	}

	return false
}
