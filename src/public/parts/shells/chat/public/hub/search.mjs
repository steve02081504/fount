/**
 * Hub 跨频道消息搜索面板。
 */
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

import { searchGroupChannelMessages } from '../src/api/groupChannel.mjs'
import { handleUIError } from '../src/ui/errors.mjs'

import { hubStore } from './core/state.mjs'
import { selectChannel } from './groupNav.mjs'
import { scrollToMessageEventId } from './messages/messages.mjs'

/** @type {ReturnType<typeof setTimeout> | null} */
let searchDebounce = null

/**
 * @returns {HTMLElement | null} 搜索结果容器
 */
function searchResultsHost() {
	return document.getElementById('hub-search-results')
}

/**
 * @returns {void}
 */
function hideSearchResults() {
	const host = searchResultsHost()
	if (host) {
		host.innerHTML = ''
		host.setAttribute('hidden', '')
	}
}

/**
 * @param {object[]} items 搜索结果
 * @returns {void}
 */
function renderSearchResults(items) {
	const host = searchResultsHost()
	if (!host) return
	if (!items.length) {
		host.innerHTML = '<div class="hub-search-empty" data-i18n="chat.hub.search.noResults">无结果</div>'
		host.removeAttribute('hidden')
		return
	}
	const channels = hubStore.context.currentState?.channels || {}
	host.innerHTML = items.map(item => {
		const channelName = escapeHtml(channels[item.channelId]?.name || item.channelId || '')
		const text = escapeHtml(String(item.text || '').slice(0, 160))
		return `<button type="button" class="hub-search-result" data-channel-id="${escapeHtml(item.channelId)}" data-event-id="${escapeHtml(item.eventId)}">
			<div class="hub-search-result-meta">${channelName}</div>
			<div class="hub-search-result-text">${text}</div>
		</button>`
	}).join('')
	host.removeAttribute('hidden')
	host.querySelectorAll('.hub-search-result').forEach(button => {
		button.addEventListener('click', () => {
			const channelId = button.getAttribute('data-channel-id')
			const eventId = button.getAttribute('data-event-id')
			if (!channelId || !eventId) return
			hideSearchResults()
			void (async () => {
				await selectChannel(channelId)
				await scrollToMessageEventId(eventId)
			})()
		})
	})
}

/**
 * @param {string} query 搜索词
 * @returns {Promise<void>}
 */
export async function runHubMessageSearch(query) {
	const groupId = hubStore.context.currentGroupId
	if (!groupId || query.length < 2) {
		hideSearchResults()
		return
	}
	try {
		const { items } = await searchGroupChannelMessages(groupId, query, {
			channelId: hubStore.context.currentChannelId || undefined,
			limit: 40,
		})
		renderSearchResults(items)
	}
	catch (error) {
		handleUIError(error, 'chat.hub.search.failed')
		hideSearchResults()
	}
}

/**
 * @param {string} query 原始输入
 * @returns {void}
 */
export function scheduleHubMessageSearch(query) {
	if (searchDebounce) clearTimeout(searchDebounce)
	const trimmed = query.trim()
	if (trimmed.length < 2) {
		hideSearchResults()
		return
	}
	searchDebounce = setTimeout(() => {
		void runHubMessageSearch(trimmed)
	}, 250)
}

/**
 * @returns {void}
 */
export function wireHubSearchPanel() {
	document.addEventListener('click', event => {
		const host = searchResultsHost()
		if (!host || host.hasAttribute('hidden')) return
		if (event.target instanceof Node && host.contains(event.target)) return
		if (event.target instanceof Element && event.target.closest('#hub-header-search')) return
		hideSearchResults()
	})
}
