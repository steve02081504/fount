import { renderTemplate } from '/scripts/features/template.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { refreshQuotePreview } from '../composer.mjs'
import { parseActionKey, queryByActionKey } from '../lib/actionKey.mjs'
import {
	applyLikeButtonOptimistic,
	bumpRepostCount,
	rollbackLikeButton,
	runSocialWrite,
} from '../lib/socialWrite.mjs'
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
	const cardRoot = target.closest('.post-card') || document
	const likeButton = target.closest('[data-like]')
	if (likeButton instanceof HTMLElement && likeButton.dataset.like) {
		const parsed = parseActionKey(likeButton.dataset.like)
		if (parsed) {
			const { entityHash, postId } = parsed
			const liked = likeButton.dataset.liked === '1'
			const snapshot = applyLikeButtonOptimistic(likeButton, !liked)
			try {
				await runSocialWrite('like', () => appContext.socialApi(`/posts/${entityHash}/${postId}/like`, {
					method: 'POST',
					body: JSON.stringify({ like: !liked }),
				}))
			}
			catch {
				rollbackLikeButton(likeButton, snapshot)
			}
		}
	}

	const repostButton = target.closest('[data-repost]')
	if (repostButton instanceof HTMLElement && repostButton.dataset.repost)
		queryByActionKey('data-repost-for', repostButton.dataset.repost, cardRoot)?.classList.toggle('hidden')

	const submitRepostButton = target.closest('[data-submit-repost]')
	if (submitRepostButton instanceof HTMLElement && submitRepostButton.dataset.submitRepost) {
		const actionKey = submitRepostButton.dataset.submitRepost
		const panel = queryByActionKey('data-repost-for', actionKey, cardRoot)
		const textarea = panel?.querySelector('textarea')
		const comment = textarea?.value.trim() || ''
		const parsed = parseActionKey(actionKey)
		if (parsed) {
			const { entityHash, postId } = parsed
			const card = submitRepostButton.closest('.post-card')
			const prevRepost = card ? bumpRepostCount(card, 1) : 0
			try {
				await runSocialWrite('repost', () => appContext.socialApi(`/posts/${entityHash}/${postId}/repost`, {
					method: 'POST',
					body: JSON.stringify({ comment }),
				}))
				if (textarea) textarea.value = ''
				panel?.classList.add('hidden')
			}
			catch {
				if (card) bumpRepostCount(card, -1)
			}
		}
	}

	const quoteButton = target.closest('[data-quote]')
	if (quoteButton instanceof HTMLElement && quoteButton.dataset.quote) {
		const parsed = parseActionKey(quoteButton.dataset.quote)
		if (parsed) {
			const { entityHash, postId } = parsed
			const card = quoteButton.closest('.post-card')
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

	const repliesButton = target.closest('[data-replies]')
	if (repliesButton instanceof HTMLElement && repliesButton.dataset.replies) {
		const actionKey = repliesButton.dataset.replies
		const parsed = parseActionKey(actionKey)
		if (parsed) {
			const { entityHash, postId } = parsed
			const panel = queryByActionKey('data-replies-for', actionKey, cardRoot)
			if (!panel) return false
			panel.classList.toggle('hidden')
			if (panel.dataset.loaded) return false
			const data = await appContext.socialApi(`/profile/${entityHash}/replies/${postId}`)
			await renderRepliesPanel(appContext, panel, data.replies || [])
			panel.dataset.loaded = '1'
		}
	}

	const submitReplyButton = target.closest('[data-submit-reply]')
	if (submitReplyButton instanceof HTMLElement && submitReplyButton.dataset.submitReply) {
		const actionKey = submitReplyButton.dataset.submitReply
		const parsed = parseActionKey(actionKey)
		if (parsed) {
			const { entityHash, postId } = parsed
			const panel = queryByActionKey('data-replies-for', actionKey, cardRoot)
			const textarea = panel?.querySelector('textarea')
			const text = textarea?.value.trim()
			if (!text) return false
			try {
				await runSocialWrite('reply', () => submitReply(appContext, entityHash, postId, text))
				textarea.value = ''
				const data = await appContext.socialApi(`/profile/${entityHash}/replies/${postId}`)
				await renderRepliesPanel(appContext, panel, data.replies || [])
				panel.dataset.loaded = '1'
				panel.classList.remove('hidden')
			}
			catch { /* toast 已展示 */ }
		}
	}

	const translateButton = target.closest('[data-translate]')
	if (translateButton instanceof HTMLElement) {
		const cardBody = translateButton.closest('.post-card')?.querySelector('.body')
		const card = translateButton.closest('.post-card')
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
