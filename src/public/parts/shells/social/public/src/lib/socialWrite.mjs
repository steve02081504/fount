import { showToastI18n } from '../../../../../scripts/features/toast.mjs'

/**
 * 执行写操作并在失败时 toast。
 * @param {string} actionKey i18n 后缀（social.actions.{actionKey}Failed）
 * @param {() => Promise<void>} fn 写操作
 * @returns {Promise<void>}
 */
export async function runSocialWrite(actionKey, fn) {
	try {
		await fn()
	}
	catch (error) {
		const err = error instanceof Error ? error : new Error(String(error))
		showToastI18n('error', `social.actions.${actionKey}Failed`, { error: err.message })
		throw error
	}
}

/**
 * @param {HTMLElement} button like 按钮
 * @param {boolean} liked 目标 liked 状态
 * @returns {{ liked: string, count: number }} 回滚快照
 */
export function applyLikeButtonOptimistic(button, liked) {
	const countEl = button.querySelector('.action-count')
	const snapshot = {
		liked: button.dataset.liked || '0',
		count: Number(countEl?.textContent) || 0,
	}
	button.dataset.liked = liked ? '1' : '0'
	button.classList.toggle('liked', liked)
	if (countEl)
		countEl.textContent = String(Math.max(0, snapshot.count + (liked ? 1 : -1)))
	return snapshot
}

/**
 * @param {HTMLElement} button like 按钮
 * @param {{ liked: string, count: number }} snapshot 回滚快照
 * @returns {void}
 */
export function rollbackLikeButton(button, snapshot) {
	const countEl = button.querySelector('.action-count')
	button.dataset.liked = snapshot.liked
	button.classList.toggle('liked', snapshot.liked === '1')
	if (countEl) countEl.textContent = String(snapshot.count)
}

/**
 * @param {HTMLElement} button dislike 按钮
 * @param {boolean} disliked 目标 disliked 状态
 * @returns {{ disliked: string, count: number }} 回滚快照
 */
export function applyDislikeButtonOptimistic(button, disliked) {
	const countEl = button.querySelector('.action-count')
	const snapshot = {
		disliked: button.dataset.disliked || '0',
		count: Number(countEl?.textContent) || 0,
	}
	button.dataset.disliked = disliked ? '1' : '0'
	button.classList.toggle('disliked', disliked)
	if (countEl)
		countEl.textContent = String(Math.max(0, snapshot.count + (disliked ? 1 : -1)))
	return snapshot
}

/**
 * @param {HTMLElement} button dislike 按钮
 * @param {{ disliked: string, count: number }} snapshot 回滚快照
 * @returns {void}
 */
export function rollbackDislikeButton(button, snapshot) {
	const countEl = button.querySelector('.action-count')
	button.dataset.disliked = snapshot.disliked
	button.classList.toggle('disliked', snapshot.disliked === '1')
	if (countEl) countEl.textContent = String(snapshot.count)
}

/**
 * 踩/取消踩时清除同卡 like 状态（与 reducer 互斥一致）。
 * @param {HTMLElement} cardRoot 帖子卡
 * @returns {void}
 */
export function clearLikeOnCard(cardRoot) {
	const likeButton = cardRoot.querySelector('[data-like]')
	if (!(likeButton instanceof HTMLElement)) return
	if (likeButton.dataset.liked !== '1') return
	const countEl = likeButton.querySelector('.action-count')
	likeButton.dataset.liked = '0'
	likeButton.classList.remove('liked')
	if (countEl) countEl.textContent = String(Math.max(0, (Number(countEl.textContent) || 0) - 1))
}

/**
 * 赞/取消赞时清除同卡 dislike 状态（与 reducer 互斥一致）。
 * @param {HTMLElement} cardRoot 帖子卡
 * @returns {void}
 */
export function clearDislikeOnCard(cardRoot) {
	const dislikeButton = cardRoot.querySelector('[data-dislike]')
	if (!(dislikeButton instanceof HTMLElement)) return
	if (dislikeButton.dataset.disliked !== '1') return
	const countEl = dislikeButton.querySelector('.action-count')
	dislikeButton.dataset.disliked = '0'
	dislikeButton.classList.remove('disliked')
	if (countEl) countEl.textContent = String(Math.max(0, (Number(countEl.textContent) || 0) - 1))
}

/**
 * @param {HTMLElement} cardRoot 帖子卡根节点
 * @param {number} delta repost 计数增量
 * @returns {number} 原计数
 */
export function bumpRepostCount(cardRoot, delta) {
	const repostBtn = cardRoot.querySelector('[data-repost] .action-count')
	if (!repostBtn) return 0
	const prev = Number(repostBtn.textContent) || 0
	repostBtn.textContent = String(Math.max(0, prev + delta))
	return prev
}

/**
 * 乐观移除指定作者的全部帖子卡片。
 * @param {string} entityHash 作者 entityHash
 * @returns {HTMLElement[]} 被移除的节点（用于回滚）
 */
export function removePostsByAuthor(entityHash) {
	const norm = String(entityHash || '').trim().toLowerCase()
	/** @type {HTMLElement[]} */
	const removed = []
	for (const card of document.querySelectorAll('.post-card[data-author-entity]')) {
		if (!(card instanceof HTMLElement)) continue
		if (String(card.dataset.authorEntity || '').trim().toLowerCase() !== norm) continue
		removed.push(card)
		card.remove()
	}
	return removed
}

/**
 * 回滚 removePostsByAuthor 移除的卡片。
 * @param {HTMLElement[]} cards 被移除的卡片
 * @param {HTMLElement | null} anchor 插入锚点（缺省追加到 feedList）
 * @returns {void}
 */
export function restoreRemovedPosts(cards, anchor = null) {
	const list = anchor || document.getElementById('feedList') || document.getElementById('profilePostsPanel')
	if (!list) return
	for (const card of cards)
		list.appendChild(card)
}
