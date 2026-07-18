import {
	refreshGroupRefPreview,
	refreshQuotePreview,
	setComposerAdvancedOpen,
	setComposerContentWarningOpen,
	syncGroupRefInComposer,
} from '../composer.mjs'
import { socialApi } from '../lib/apiClient.mjs'
import { socialState } from '../state.mjs'
import { loadFeed, setFeedRanking, updateFeedSearchChrome } from '../views/feed.mjs'
import { markNotificationsSeen, setNotificationFilter } from '../views/notifications.mjs'

/**
 * 处理发帖框与 Feed 顶栏相关点击。
 * @param {HTMLElement} target 点击目标
 * @returns {Promise<void>}
 */
export async function handleComposerFeedClick(target) {
	if (target.closest('.clear-quote-btn')) {
		socialState.pendingQuoteRef = null
		await refreshQuotePreview()
	}
	if (target.closest('.clear-group-ref-btn')) {
		socialState.pendingGroupRef = null
		syncGroupRefInComposer(null)
		await refreshGroupRefPreview()
		const groupSelect = document.getElementById('linkGroupSelect')
		if (groupSelect instanceof HTMLSelectElement)
			groupSelect.value = ''
	}
	if (target.closest('#feedRefreshButton')) {
		socialState.activeFeedSearchQuery = null
		const searchInput = document.getElementById('feedSearchInput')
		if (searchInput instanceof HTMLInputElement) searchInput.value = ''
		socialState.feedCursor = null
		await socialApi('/feed/sync', { method: 'POST' })
		await loadFeed(false)
		updateFeedSearchChrome()
	}
	const rankingTab = target.closest('[data-feed-ranking]')
	if (rankingTab instanceof HTMLElement && rankingTab.dataset.feedRanking)
		await setFeedRanking(rankingTab.dataset.feedRanking)
	if (target.closest('#pollComposerToggle')) {
		const panel = document.getElementById('pollComposerPanel')
		panel?.classList.toggle('hidden')
		document.getElementById('pollComposerToggle')?.classList.toggle('active', !panel?.classList.contains('hidden'))
	}
	if (target.closest('#composerCwToggle'))
		setComposerContentWarningOpen()
	if (target.closest('#composerAdvancedToggle'))
		setComposerAdvancedOpen()
	if (target.closest('#pollComposerApply')) {
		const optionsRaw = document.getElementById('pollComposerOptions')?.value || ''
		const options = optionsRaw.split('\n').map(line => line.trim()).filter(Boolean)
		const multi = document.getElementById('pollComposerMulti')?.checked === true
		const deadlineRaw = document.getElementById('pollComposerDeadline')?.value?.trim()
		socialState.pendingPoll = options.length >= 2
			? { options, multi, deadline: deadlineRaw ? new Date(deadlineRaw).toISOString() : null }
			: null
		document.getElementById('pollComposerPanel')?.classList.add('hidden')
		document.getElementById('pollComposerToggle')?.classList.toggle('active', Boolean(socialState.pendingPoll))
	}
	if (target.closest('#notificationsMarkAllButton'))
		void markNotificationsSeen()
	const filterButton = target.closest('[data-notif-filter]')
	if (filterButton instanceof HTMLButtonElement && filterButton.dataset.notifFilter)
		void setNotificationFilter(filterButton.dataset.notifFilter)
}
