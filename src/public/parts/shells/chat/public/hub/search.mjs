/**
 * Hub 跨频道消息搜索面板。
 */
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

import { setElementI18n } from '../../../../scripts/i18n/index.mjs'
import { searchAllChatGroups, searchGroupChannelMessages } from '../src/api/groupChannel.mjs'
import { handleUIError } from '../src/ui/errors.mjs'

import { bindDismissOnDocumentInteraction } from './core/contextMenuDismiss.mjs'
import { hubStore } from './core/state.mjs'
import { scrollToMessageEventId } from './messages/messages.mjs'
import { selectChannel } from './sidebar/index.mjs'

/** @type {ReturnType<typeof setTimeout> | null} */
let searchDebounce = null

/** @type {(ReturnType<typeof bindDismissOnDocumentInteraction>) | null} */
let searchDismissClose = null

const SEARCH_DISMISS_IGNORE = ['#hub-header-search', '#hub-search-results', '#hub-mobile-search']

const SCOPE_I18N = {
	group: 'chat.hub.search.scopeGroup',
	all: 'chat.hub.search.scopeAll',
}

/**
 * @returns {HTMLElement | null} 搜索结果容器
 */
function searchResultsHost() {
	return document.getElementById('hub-search-results')
}

/**
 * @returns {void} 无
 */
function clearSearchResultsDom() {
	const host = searchResultsHost()
	if (host) {
		host.innerHTML = ''
		host.setAttribute('hidden', '')
	}
}

/**
 * @returns {void} 无
 */
function hideSearchResults() {
	searchDismissClose?.unbind()
	searchDismissClose = null
	clearSearchResultsDom()
}

/**
 * 结果面板可见时绑定文档 dismiss（打开时绑定，关闭时解绑）。
 * @returns {void} 无
 */
function armSearchDismiss() {
	searchDismissClose?.unbind()
	searchDismissClose = bindDismissOnDocumentInteraction(() => {
		searchDismissClose = null
		clearSearchResultsDom()
	}, { contextMenu: false, ignoreSelectors: SEARCH_DISMISS_IGNORE })
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
		armSearchDismiss()
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
	armSearchDismiss()
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
 * @param {string | null | undefined} value 原始值
 * @returns {'group' | 'all'} 规范化作用域
 */
function normalizeSearchScope(value) {
	return value === 'all' ? 'all' : 'group'
}

/**
 * @param {HTMLElement | null} trigger 作用域按钮
 * @param {'group' | 'all'} value 作用域
 * @returns {void} 无
 */
function paintSearchScopeTrigger(trigger, value) {
	if (!trigger) return
	trigger.dataset.value = value
	const label = trigger.querySelector('.hub-search-scope-label')
	if (label instanceof HTMLElement) setElementI18n(label, SCOPE_I18N[value])
}

/**
 * @param {'group' | 'all'} value 作用域
 * @returns {void} 无
 */
export function setHubSearchScope(value) {
	const scope = normalizeSearchScope(value)
	for (const id of ['hub-search-scope', 'hub-mobile-search-scope'])
		paintSearchScopeTrigger(document.getElementById(id), scope)
}

/**
 * @returns {'group' | 'all'} 当前作用域
 */
function hubSearchScope() {
	return normalizeSearchScope(document.getElementById('hub-search-scope')?.dataset?.value)
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
	document.querySelectorAll('.hub-search-scope-menu [data-value]').forEach(option => {
		option.addEventListener('click', () => {
			const value = normalizeSearchScope(option.getAttribute('data-value'))
			setHubSearchScope(value)
			if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
		})
	})
}
