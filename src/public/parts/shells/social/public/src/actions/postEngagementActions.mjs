import { mountTranslationBlock, requestTranslation, resolveTargetLang } from '/scripts/features/translate.mjs'
import { refreshQuotePreview } from '../composer.mjs'
import { parseActionKey, queryByActionKey } from '../lib/actionKey.mjs'
import { SOCIAL_API, socialApi } from '../lib/apiClient.mjs'
import { submitReply } from '../lib/replies.mjs'
import {
	applyDislikeButtonOptimistic,
	applyLikeButtonOptimistic,
	bumpRepostCount,
	clearDislikeOnCard,
	clearLikeOnCard,
	rollbackDislikeButton,
	rollbackLikeButton,
	runSocialWrite,
} from '../lib/socialWrite.mjs'
import { focusComposer } from '../navigation.mjs'
import { socialState } from '../state.mjs'
import { renderRepliesPanel } from '../views/replies.mjs'

import { closePostMoreMenus } from './shared.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'

/**
 * @param {HTMLElement} target 点击目标元素
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handlePostEngagementClick(target) {
	const cardRoot = target.closest('.post-card') || document
	const dislikeButton = target.closest('[data-dislike]')
	if (dislikeButton instanceof HTMLElement && dislikeButton.dataset.dislike) {
		const parsed = parseActionKey(dislikeButton.dataset.dislike)
		if (parsed) {
			const { entityHash, postId } = parsed
			const disliked = dislikeButton.dataset.disliked === '1'
			const snapshot = applyDislikeButtonOptimistic(dislikeButton, !disliked)
			const card = dislikeButton.closest('.post-card')
			if (!disliked && card instanceof HTMLElement) clearLikeOnCard(card)
			try {
				await runSocialWrite('dislike', () => socialApi(`/posts/${entityHash}/${postId}/dislike`, {
					method: 'POST',
					body: JSON.stringify({ dislike: !disliked }),
				}))
			}
			catch {
				rollbackDislikeButton(dislikeButton, snapshot)
			}
		}
	}

	const likeButton = target.closest('[data-like]')
	if (likeButton instanceof HTMLElement && likeButton.dataset.like) {
		const parsed = parseActionKey(likeButton.dataset.like)
		if (parsed) {
			const { entityHash, postId } = parsed
			const liked = likeButton.dataset.liked === '1'
			const snapshot = applyLikeButtonOptimistic(likeButton, !liked)
			const card = likeButton.closest('.post-card')
			if (!liked && card instanceof HTMLElement) clearDislikeOnCard(card)
			try {
				await runSocialWrite('like', () => socialApi(`/posts/${entityHash}/${postId}/like`, {
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
				await runSocialWrite('repost', () => socialApi(`/posts/${entityHash}/${postId}/repost`, {
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
			socialState.pendingQuoteRef = { entityHash, postId, text }
			await refreshQuotePreview()
			await focusComposer({ switchToFeed: true })
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
			const data = await socialApi(`/profile/${entityHash}/replies/${postId}`)
			await renderRepliesPanel(panel, data.replies || [])
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
				await runSocialWrite('reply', () => submitReply(entityHash, postId, text))
				textarea.value = ''
				const data = await socialApi(`/profile/${entityHash}/replies/${postId}`)
				await renderRepliesPanel(panel, data.replies || [])
				panel.dataset.loaded = '1'
				panel.classList.remove('hidden')
				const countElement = queryByActionKey('data-replies', actionKey, cardRoot)?.querySelector('.action-count')
				if (countElement) countElement.textContent = String((data.replies || []).length)
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
		const translated = await requestTranslation(
			`${SOCIAL_API}/translate`,
			text,
			resolveTargetLang(),
		)
		mountTranslationBlock(cardBody, {
			originalText: text,
			translatedText: translated,
			translationLabel: geti18n('social.translate.label'),
			showOriginalLabel: geti18n('common.translate.showOriginal'),
			showTranslationLabel: geti18n('common.translate.showTranslation'),
		})
		closePostMoreMenus()
	}

	return false
}
