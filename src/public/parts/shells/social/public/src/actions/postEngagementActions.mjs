import { mountTranslationBlock, resolveTargetLang } from '/scripts/features/translate.mjs'
import { refreshQuotePreview } from '../composer.mjs'
import { dislikePost, likePost, repostPost, translatePost } from '../endpoints/posts.mjs'
import { getProfileReplies } from '../endpoints/profile.mjs'
import { parseActionKey, queryByActionKey } from '../lib/actionKey.mjs'
import { submitReply } from '../lib/replies.mjs'
import {
	applyDislikeButtonOptimistic,
	applyLikeButtonOptimistic,
	bumpRepostCount,
	clearDislikeOnCard,
	clearLikeOnCard,
	rollbackDislikeButton,
	rollbackLikeButton,
	runWrite,
} from '../lib/socialWrite.mjs'
import { focusComposer } from '../navigation.mjs'
import { state } from '../state.mjs'
import { prependFeedItem } from '../views/feed.mjs'
import { renderRepliesPanel } from '../views/replies.mjs'
import { syncVideoCommentTicker } from '../views/video.mjs'

import { closePostMoreMenus } from './shared.mjs'

/**
 * @param {HTMLElement} target 点击目标元素
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handlePostEngagementClick(target) {
	// 短视频 slide 与 feed 卡可能共享同一 actionKey；必须先收窄到当前容器
	const cardRoot = target.closest('.post-card, .reply, .video-slide') || document
	const dislikeButton = target.closest('[data-dislike]')
	if (dislikeButton instanceof HTMLElement && dislikeButton.dataset.dislike) {
		const parsed = parseActionKey(dislikeButton.dataset.dislike)
		if (parsed) {
			const { entityHash, postId } = parsed
			const disliked = dislikeButton.dataset.disliked === '1'
			const snapshot = applyDislikeButtonOptimistic(dislikeButton, !disliked)
			const card = dislikeButton.closest('.post-card, .reply')
			if (!disliked && card instanceof HTMLElement) clearLikeOnCard(card)
			try {
				await runWrite('dislike', () => dislikePost(entityHash, postId, !disliked))
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
			const card = likeButton.closest('.post-card, .reply')
			if (!liked && card instanceof HTMLElement) clearDislikeOnCard(card)
			try {
				await runWrite('like', () => likePost(entityHash, postId, !liked))
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
			const card = submitRepostButton.closest('.post-card, .reply')
			const prevRepost = card ? bumpRepostCount(card, 1) : 0
			try {
				const data = await runWrite('repost', () => repostPost(entityHash, postId, comment))
				if (textarea) textarea.value = ''
				panel?.classList.add('hidden')
				if (data?.item)
					await prependFeedItem(data.item, { force: true })
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
			state.pendingQuoteRef = { entityHash, postId, text }
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
			if (panel.dataset.loaded) {
				panel.classList.toggle('hidden')
				return false
			}
			// 先加载再显示，避免测试/用户在 replaceChildren 前写入被清掉的 textarea
			const data = await getProfileReplies(entityHash, postId)
			await renderRepliesPanel(panel, data.replies || [])
			panel.dataset.loaded = '1'
			panel.classList.remove('hidden')
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
				await runWrite('reply', () => submitReply(entityHash, postId, text))
				textarea.value = ''
				const data = await getProfileReplies(entityHash, postId)
				const replies = data.replies || []
				await renderRepliesPanel(panel, replies)
				panel.dataset.loaded = '1'
				panel.classList.remove('hidden')
				const countElement = queryByActionKey('data-replies', actionKey, cardRoot)?.querySelector('.action-count')
				if (countElement) countElement.textContent = String(replies.length)
				const slide = panel.closest('.video-slide')
				if (slide instanceof HTMLElement) syncVideoCommentTicker(slide, replies)
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
		const translated = await translatePost(text, resolveTargetLang())
		mountTranslationBlock(cardBody, {
			originalText: text,
			translatedText: translated,
		})
		closePostMoreMenus()
	}

	return false
}
