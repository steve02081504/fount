/** Hub 群发现主内容页。 */
import { mountTemplate, renderTemplate } from '../../../../scripts/features/template.mjs'
import { geti18n } from '../../../../scripts/i18n/index.mjs'
import { fetchDiscoveryIndex, refreshDiscoveryGossip } from '../src/api/discoveryApi.mjs'
import { handleUIError } from '../src/ui/errors.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

import { setPinsBookmarksWrapVisible, updateStatusBanners } from './banners.mjs'
import { hubStore } from './core/state.mjs'
import { updateDiscoveryHash } from './core/urlHash.mjs'
import { cancelScheduledChannelRefresh } from './messages/channelRefreshScheduler.mjs'
import { clearPrivateGroupState } from './privateGroup.mjs'
import { selectGroup } from './sidebar/index.mjs'
import { closeGroupWebSocket } from './stream/index.mjs'

let loadGeneration = 0

/**
 * @param {HTMLElement} grid 卡片容器
 * @param {Array<{ groupId: string, title?: string, blurb?: string, sources?: Array<{ fromNodeHash?: string }> }>} entries 发现条目
 * @returns {Promise<void>}
 */
async function paintDiscoveryEntries(grid, entries) {
	if (!entries.length) {
		await mountTemplate(grid, 'hub/discovery/empty')
		return
	}
	const joinedIds = new Set(hubStore.sidebar.groups.map(group => String(group.id || group.groupId || '')))
	grid.replaceChildren(...await Promise.all(entries.map(async entry => {
		const title = String(entry.title || entry.groupId)
		return renderTemplate('hub/discovery/card', {
			groupId: escapeHtml(entry.groupId),
			title: escapeHtml(title),
			initial: escapeHtml(Array.from(title)[0] || '#'),
			blurb: escapeHtml(entry.blurb || ''),
			sourceLabel: escapeHtml(await geti18n('chat.hub.discoverySourceCount', {
				count: String(entry.sources?.length || 0),
			})),
			actionKey: joinedIds.has(String(entry.groupId))
				? 'chat.hub.discoveryOpen'
				: 'chat.hub.discoveryJoin',
		})
	})))
}

/**
 * @param {HTMLElement} root 页面根
 * @returns {Promise<void>}
 */
async function loadDiscoveryEntries(root) {
	const generation = ++loadGeneration
	const grid = root.querySelector('[data-discovery-grid]')
	const refreshButton = root.querySelector('[data-discovery-refresh]')
	if (!(grid instanceof HTMLElement)) return
	grid.setAttribute('aria-busy', 'true')
	refreshButton?.setAttribute('disabled', '')
	try {
		await refreshDiscoveryGossip()
		const data = await fetchDiscoveryIndex({ limit: 80 })
		if (generation !== loadGeneration || !root.isConnected) return
		await paintDiscoveryEntries(grid, data.entries || [])
	}
	catch (error) {
		if (generation !== loadGeneration || !root.isConnected) return
		handleUIError(error, 'chat.hub.discoveryLoadFailed')
		await mountTemplate(grid, 'hub/empty/error', {
			i18nKey: 'chat.hub.discoveryLoadFailed',
			errorMessage: error.message,
		})
	}
	finally {
		if (generation === loadGeneration) {
			grid.removeAttribute('aria-busy')
			refreshButton?.removeAttribute('disabled')
		}
	}
}

/** @returns {Promise<void>} 激活群发现主内容页。 */
export async function activateDiscoveryView() {
	updateDiscoveryHash()
	cancelScheduledChannelRefresh()
	closeGroupWebSocket()
	clearPrivateGroupState()
	hubStore.context.currentGroupId = null
	hubStore.context.currentChannelId = null
	hubStore.context.currentState = null
	setPinsBookmarksWrapVisible(false)
	updateStatusBanners()

	const channelList = document.getElementById('hub-channel-list')
	if (channelList)
		await mountTemplate(channelList, 'hub/nav/side_muted', { i18nKey: 'chat.hub.discoverySidebarHint' })
	document.getElementById('hub-member-list').replaceChildren()
	document.getElementById('hub-info-card-host').replaceChildren()
	document.getElementById('hub-group-name-display').dataset.i18n = 'chat.hub.discoveryTitle'
	document.getElementById('hub-channel-name-display').dataset.i18n = 'chat.hub.discoveryTitle'

	const messagesHost = document.getElementById('hub-messages')
	await mountTemplate(messagesHost, 'hub/discovery/panel')
	const root = messagesHost.querySelector('.hub-discovery-page')
	if (!(root instanceof HTMLElement)) return
	root.querySelector('[data-discovery-refresh]')?.addEventListener('click', () => {
		void loadDiscoveryEntries(root)
	})
	root.addEventListener('click', event => {
		const target = event.target instanceof Element ? event.target.closest('[data-group-id]') : null
		const groupId = target?.getAttribute('data-group-id')
		if (!groupId) return
		void selectGroup(groupId).catch(error => handleUIError(error, 'chat.hub.loadGroupFailed'))
	})

	const { disableComposer, refreshHubHeaderButtons } = await import('./messages/composerController.mjs')
	disableComposer('chat.hub.composerDisabled')
	refreshHubHeaderButtons()
	await loadDiscoveryEntries(root)
}
