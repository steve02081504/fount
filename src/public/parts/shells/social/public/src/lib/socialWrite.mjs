import { showToastI18n } from '../../../../../scripts/features/toast.mjs'

/**
 * 执行写操作并在失败时 toast。
 * @template T
 * @param {string} actionKey i18n 后缀（social.actions.{actionKey}Failed）
 * @param {() => Promise<T>} fn 写操作
 * @returns {Promise<T>} fn 的返回值
 */
export async function runWrite(actionKey, fn) {
	try {
		return await fn()
	}
	catch (error) {
		const err = error instanceof Error ? error : new Error(String(error))
		showToastI18n('error', `social.actions.${actionKey}Failed`, { error: err.message })
		throw error
	}
}

/**
 * @param {HTMLElement} button like / dislike 按钮
 * @param {'liked' | 'disliked'} key 状态键
 * @param {boolean} active 是否激活
 * @returns {void}
 */
function syncReactionI18n(button, key, active) {
	if (!button.dataset.i18n) return
	button.dataset.i18n = key === 'liked'
		? active ? 'social.actions.unlike' : 'social.actions.like'
		: active ? 'social.actions.undislike' : 'social.actions.dislike'
}

/**
 * @param {HTMLElement} button 按钮
 * @param {string} key dataset 键 liked|disliked
 * @param {string} className 激活 class
 * @param {boolean} next 目标状态
 * @returns {{ [key: string]: string | number }} 回滚快照
 */
function applyReactionOptimistic(button, key, className, next) {
	const countEl = button.querySelector('.action-count')
	const snapshot = { [key]: button.dataset[key] || '0', count: Number(countEl?.textContent) || 0 }
	button.dataset[key] = next ? '1' : '0'
	button.classList.toggle(className, next)
	syncReactionI18n(button, /** @type {'liked' | 'disliked'} */ key, next)
	if (countEl) countEl.textContent = String(Math.max(0, /** @type {number} */ snapshot.count + (next ? 1 : -1)))
	return snapshot
}

/**
 * @param {HTMLElement} button 按钮
 * @param {string} key dataset 键
 * @param {string} className 激活 class
 * @param {{ [key: string]: string | number }} snapshot 回滚快照
 * @returns {void}
 */
function rollbackReaction(button, key, className, snapshot) {
	const countEl = button.querySelector('.action-count')
	button.dataset[key] = String(snapshot[key])
	button.classList.toggle(className, snapshot[key] === '1')
	syncReactionI18n(button, /** @type {'liked' | 'disliked'} */ key, snapshot[key] === '1')
	if (countEl) countEl.textContent = String(snapshot.count)
}

/**
 * @param {HTMLElement} cardRoot 帖卡
 * @param {string} selector 按钮选择器
 * @param {string} key dataset 键
 * @param {string} className 激活 class
 * @returns {void}
 */
function clearReactionOnCard(cardRoot, selector, key, className) {
	const button = cardRoot.querySelector(selector)
	if (!(button instanceof HTMLElement) || button.dataset[key] !== '1') return
	const countEl = button.querySelector('.action-count')
	button.dataset[key] = '0'
	button.classList.remove(className)
	syncReactionI18n(button, /** @type {'liked' | 'disliked'} */ key, false)
	if (countEl) countEl.textContent = String(Math.max(0, (Number(countEl.textContent) || 0) - 1))
}

/**
 * @param {HTMLElement} button like 按钮
 * @param {boolean} liked 目标 liked 状态
 * @returns {{ liked: string, count: number }} 回滚快照
 */
export function applyLikeButtonOptimistic(button, liked) {
	return /** @type {{ liked: string, count: number }} */ applyReactionOptimistic(button, 'liked', 'liked', liked)
}

/**
 * @param {HTMLElement} button like 按钮
 * @param {{ liked: string, count: number }} snapshot 回滚快照
 * @returns {void}
 */
export function rollbackLikeButton(button, snapshot) {
	rollbackReaction(button, 'liked', 'liked', snapshot)
}

/**
 * @param {HTMLElement} button dislike 按钮
 * @param {boolean} disliked 目标 disliked 状态
 * @returns {{ disliked: string, count: number }} 回滚快照
 */
export function applyDislikeButtonOptimistic(button, disliked) {
	return /** @type {{ disliked: string, count: number }} */ applyReactionOptimistic(button, 'disliked', 'disliked', disliked)
}

/**
 * @param {HTMLElement} button dislike 按钮
 * @param {{ disliked: string, count: number }} snapshot 回滚快照
 * @returns {void}
 */
export function rollbackDislikeButton(button, snapshot) {
	rollbackReaction(button, 'disliked', 'disliked', snapshot)
}

/**
 * @param {HTMLElement} cardRoot 帖卡
 * @returns {void}
 */
export function clearLikeOnCard(cardRoot) {
	clearReactionOnCard(cardRoot, '[data-like]', 'liked', 'liked')
}

/**
 * @param {HTMLElement} cardRoot 帖卡
 * @returns {void}
 */
export function clearDislikeOnCard(cardRoot) {
	clearReactionOnCard(cardRoot, '[data-dislike]', 'disliked', 'disliked')
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
 * 从 feed 循环重放源剔除指定帖子。
 * @param {{ feedShownItems?: object[] | null }} state 应用 state
 * @param {string} postId 帖子 id
 * @returns {object[]} 被剔除的条目（用于回滚）
 */
export function purgeFeedShownPost(state, postId) {
	if (!state.feedShownItems?.length || !postId) return []
	const kept = []
	const removed = []
	for (const item of state.feedShownItems)
		if (item.postId === postId) removed.push(item)
		else kept.push(item)
	state.feedShownItems = kept.length ? kept : null
	return removed
}

/**
 * 从 feed 循环重放源剔除指定作者的帖子。
 * @param {{ feedShownItems?: object[] | null }} state 应用 state
 * @param {string} entityHash 作者 entityHash
 * @returns {object[]} 被剔除的条目（用于回滚）
 */
export function purgeFeedShownAuthor(state, entityHash) {
	if (!state.feedShownItems?.length || !entityHash) return []
	const kept = []
	const removed = []
	for (const item of state.feedShownItems)
		if (item.entityHash === entityHash) removed.push(item)
		else kept.push(item)
	state.feedShownItems = kept.length ? kept : null
	return removed
}

/**
 * 把 purge 掉的条目塞回 feedShownItems。
 * @param {{ feedShownItems?: object[] | null }} state 应用 state
 * @param {object[]} items 先前剔除的条目
 * @returns {void}
 */
export function restoreFeedShownItems(state, items) {
	if (!items?.length) return
	state.feedShownItems = [...state.feedShownItems || [], ...items]
}

/**
 * @typedef {{ card: HTMLElement, parent: HTMLElement | null, nextSibling: ChildNode | null }} RemovedPostCard
 */

/**
 * 乐观移除指定帖子 id 的全部卡片（含重复节点）。
 * @param {string} postId 帖子 id
 * @returns {RemovedPostCard[]} 被移除的节点与原位置（用于回滚）
 */
export function removePostsById(postId) {
	/** @type {RemovedPostCard[]} */
	const removed = []
	for (const card of document.querySelectorAll(`[data-post-id="${CSS.escape(postId)}"]`)) {
		if (!(card instanceof HTMLElement)) continue
		removed.push({ card, parent: card.parentElement, nextSibling: card.nextSibling })
		card.remove()
	}
	return removed
}

/**
 * 乐观移除指定作者的全部帖子卡片。
 * @param {string} entityHash 作者 entityHash
 * @returns {RemovedPostCard[]} 被移除的节点与原位置（用于回滚）
 */
export function removePostsByAuthor(entityHash) {
	/** @type {RemovedPostCard[]} */
	const removed = []
	for (const card of document.querySelectorAll('.post-card[data-author-entity]')) {
		if (!(card instanceof HTMLElement)) continue
		if (card.dataset.authorEntity !== entityHash) continue
		removed.push({ card, parent: card.parentElement, nextSibling: card.nextSibling })
		card.remove()
	}
	return removed
}

/**
 * 按原父节点与插入点回滚移除的卡片（逆序）。
 * @param {RemovedPostCard[]} entries 被移除的卡片条目
 * @returns {void}
 */
export function restoreRemovedPosts(entries) {
	for (let index = entries.length - 1; index >= 0; index--) {
		const { card, parent, nextSibling } = entries[index]
		if (!parent) continue
		parent.insertBefore(card, nextSibling?.parentNode === parent ? nextSibling : null)
	}
}
