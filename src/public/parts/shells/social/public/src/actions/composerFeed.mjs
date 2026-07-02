import {
	refreshGroupRefPreview,
	refreshQuotePreview,
	syncGroupRefInComposer,
} from '../composer.mjs'
import { clearFeedSearch, loadFeed, runFeedSearch, updateFeedSearchChrome } from '../views/feed.mjs'
import { markNotificationsSeen } from '../views/notifications.mjs'

/**
 * 处理发帖框与 Feed 顶栏相关点击。
 * @param {object} appContext 应用上下文
 * @param {HTMLElement} target 点击目标
 * @returns {Promise<void>}
 */
export async function handleComposerFeedClick(appContext, target) {
	if (target.closest('.clear-quote-btn')) {
		appContext.state.pendingQuoteRef = null
		await refreshQuotePreview(appContext)
	}
	if (target.closest('.clear-group-ref-btn')) {
		appContext.state.pendingGroupRef = null
		syncGroupRefInComposer(null)
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
		await appContext.socialApi('/feed/sync', { method: 'POST' })
		await loadFeed(appContext, false)
		updateFeedSearchChrome(appContext)
	}
	if (target.closest('#feedSearchBtn'))
		await runFeedSearch(appContext)
	if (target.closest('#feedSearchClearBtn'))
		await clearFeedSearch(appContext)
	if (target.closest('#notificationsMarkAllBtn'))
		markNotificationsSeen(appContext)
}
