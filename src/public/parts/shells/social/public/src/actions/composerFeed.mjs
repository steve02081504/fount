import {
	refreshGroupRefPreview,
	refreshQuotePreview,
	syncGroupRefInComposer,
} from '../composer.mjs'
import { clearFeedSearch, loadFeed, runFeedSearch, updateFeedSearchChrome } from '../views/feed.mjs'
import { markNotificationsSeen, setNotificationFilter } from '../views/notifications.mjs'

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
	if (target.closest('#feedRefreshButton')) {
		appContext.state.activeFeedSearchQuery = null
		const searchInput = document.getElementById('feedSearchInput')
		if (searchInput instanceof HTMLInputElement) searchInput.value = ''
		appContext.state.feedCursor = null
		await appContext.socialApi('/feed/sync', { method: 'POST' })
		await loadFeed(appContext, false)
		updateFeedSearchChrome(appContext)
	}
	if (target.closest('#feedSearchButton'))
		await runFeedSearch(appContext)
	if (target.closest('#feedSearchClearButton'))
		await clearFeedSearch(appContext)
	if (target.closest('#notificationsMarkAllButton'))
		void markNotificationsSeen(appContext)
	const filterButton = target.closest('[data-notif-filter]')
	if (filterButton instanceof HTMLButtonElement && filterButton.dataset.notifFilter)
		void setNotificationFilter(appContext, filterButton.dataset.notifFilter)
}
