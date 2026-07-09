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
