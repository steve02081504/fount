/**
 * Hub 跨频道消息搜索面板。
 */
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

import { searchAllChatGroups, searchGroupChannelMessages } from '../src/api/groupChannel.mjs'
import { handleUIError } from '../src/ui/errors.mjs'

import { hubStore } from './core/state.mjs'
import { scrollToMessageEventId } from './messages/messages.mjs'
import { selectChannel } from './sidebar/index.mjs'

/** @type {ReturnType<typeof setTimeout> | null} */
let searchDebounce = null

/**
 * @returns {HTMLElement | null} 搜索结果容器
 */
function searchResultsHost() {
	return document.getElementById('hub-search-results')
}

/**
 * @returns {void} 无
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
 * @param {string} [scope] 作用域
 * @returns {void} 无
 */
function renderSearchResults(items, scope = 'group') {
	const host = searchResultsHost()
	if (!host) return
	if (!items.length) {
		host.innerHTML = '<div class="hub-search-empty" data-i18n="chat.hub.search.noResults">无结果</div>'
		host.removeAttribute('hidden')
		return
	}
	const channels = hubStore.context.currentState?.channels || {}
	host.innerHTML = items.map(item => {
		const channelName = scope === 'all'
			? escapeHtml(String(item.groupId || ''))
			: escapeHtml(channels[item.channelId]?.name || item.channelId || '')
		const text = escapeHtml(String(item.text || '').slice(0, 160))
		return `<button type="button" class="hub-search-result" data-group-id="${escapeHtml(item.groupId || hubStore.context.currentGroupId || '')}" data-channel-id="${escapeHtml(item.channelId)}" data-event-id="${escapeHtml(item.eventId)}">
			<div class="hub-search-result-meta">${channelName}</div>
			<div class="hub-search-result-text">${text}</div>
		</button>`
	}).join('')
	host.removeAttribute('hidden')
	host.querySelectorAll('.hub-search-result').forEach(button => {
		button.addEventListener('click', () => {
			const groupId = button.getAttribute('data-group-id')
			const channelId = button.getAttribute('data-channel-id')
			const eventId = button.getAttribute('data-event-id')
			if (!channelId || !eventId) return
			hideSearchResults()
			void (async () => {
				if (groupId && groupId !== hubStore.context.currentGroupId)
					await import('./sidebar/index.mjs').then(m => m.selectGroup(groupId))
				await selectChannel(channelId)
				await scrollToMessageEventId(eventId)
			})()
		})
	})
}

/**
 * @returns {string} group | all
 */
function hubSearchScope() {
	const select = document.getElementById('hub-search-scope')
	if (select instanceof HTMLSelectElement && select.value === 'all') return 'all'
	return 'group'
}

/**
 * @param {string} query 搜索词
 * @returns {Promise<void>} 无
 */
export async function runHubMessageSearch(query) {
	if (query.length < 2) {
		hideSearchResults()
		return
	}
	const scope = hubSearchScope()
	try {
		if (scope === 'all') {
			const { items } = await searchAllChatGroups(query, { limit: 40 })
			renderSearchResults(items, 'all')
			return
		}
		const groupId = hubStore.context.currentGroupId
		if (!groupId) {
			hideSearchResults()
			return
		}
		const { items } = await searchGroupChannelMessages(groupId, query, {
			channelId: hubStore.context.currentChannelId || undefined,
			limit: 40,
		})
		renderSearchResults(items, 'group')
	}
	catch (error) {
		handleUIError(error, 'chat.hub.search.failed')
		hideSearchResults()
	}
}

/**
 * @param {string} query 原始输入
 * @returns {void} 无
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
 * @returns {void} 无
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
