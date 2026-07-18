/**
 * 【文件】public/hub/initCore.mjs
 * 【职责】Hub 轻量引导：i18n、群列表与 hash 导航，不阻塞于 messages 重模块图。
 * 【关联】init.mjs（重型特性延后）、wireBootstrap、hashNav
 */
import { usingTemplates } from '../../../../scripts/features/template.mjs'
import { initTranslations } from '../../../../scripts/i18n/index.mjs'
import { loadAliases } from '../shared/aliases.mjs'
import { handleUIError } from '../src/ui/errors.mjs'

import { hubStore } from './core/state.mjs'
import { parseHash } from './core/urlHash.mjs'

/** @returns {Promise<void>} 拉取 viewer 到 hubStore（顶栏详情由 init.mjs 补全） */
async function loadViewerIdentity() {
	const [viewerResp, whoamiResp] = await Promise.all([
		fetch('/api/parts/shells:chat/viewer', { credentials: 'include' }),
		fetch('/api/whoami', { credentials: 'include' }),
	])
	if (whoamiResp.ok) {
		const whoami = await whoamiResp.json()
		hubStore.viewer.username = whoami.username || null
	}
	if (!viewerResp.ok) return
	const data = await viewerResp.json()
	hubStore.viewer.nodeHash = data.nodeHash || null
	hubStore.viewer.operatorEntityHash = data.viewerEntityHash || null
	hubStore.viewer.viewerEntityHash = data.viewerEntityHash || null
	hubStore.viewer.ownerEntityHash = String(data.profile?.ownerEntityHash || '').trim().toLowerCase() || null
	hubStore.viewer.agents = data.agents || []
	const { ingestAgentEntityHashList } = await import('./core/domUtils.mjs')
	ingestAgentEntityHashList(hubStore.viewer.agents)
}

/** @returns {Promise<void>} 按 URL 进入好友/群频道视图 */
async function navigateHubFromLocation() {
	const urlParams = new URLSearchParams(window.location.search)
	const charParam = urlParams.get('char')
	const contactParam = urlParams.get('contact')
	const parsed = parseHash()
	let { groupId, channelId } = parsed
	const inGroupHash = parsed.groupId != null

	const { applyChatRunUri, runUriFromPageLocation } = await import('../src/deepLinkConsume.mjs')
	const runUri = runUriFromPageLocation()
	if (runUri) {
		let applied
		try {
			applied = await applyChatRunUri(runUri)
		}
		catch (e) {
			handleUIError(e, 'chat.hub.loadGroupFailed')
		}
		if (applied?.groupId) {
			groupId = applied.groupId
			channelId = applied.channelId || channelId
			const clean = new URL(window.location.href)
			clean.searchParams.delete('url')
			clean.searchParams.delete('run')
			let hash = `group:${encodeURIComponent(groupId)}:${channelId || 'default'}`
			if (applied.eventId) hash += `;${encodeURIComponent(applied.eventId)}`
			window.history.replaceState(null, '', `${clean.pathname}${clean.search}#${hash}`)
		}
	}

	if (contactParam && !inGroupHash) {
		const { applyHubContactQuery } = await import('./hubContact.mjs')
		const handled = await applyHubContactQuery(contactParam)
		if (handled) {
			const clean = new URL(window.location.href)
			clean.searchParams.delete('contact')
			window.history.replaceState(null, '', `${clean.pathname}${clean.search}${clean.hash}`)
			return
		}
	}

	const { navigateFromHash } = await import('./hashNav.mjs')
	if (charParam && !inGroupHash) {
		const { setMode } = await import('./mode.mjs')
		await setMode('friends')
		const { enterFriendChat } = await import('./friendChat.mjs')
		const { buildCharFriendBinding } = await import('../shared/friendBinding.mjs')
		const { charAgentEntityHash } = await import('./entityResolve.mjs')
		const entityHash = await charAgentEntityHash(charParam)
		if (entityHash)
			await enterFriendChat({ binding: buildCharFriendBinding(entityHash, charParam) })
		return
	}

	await navigateFromHash()
}

/** @returns {Promise<void>} Hub 壳层就绪：翻译、群列表与 hash 导航 */
export async function initCore() {
	usingTemplates('/parts/shells:chat/src/templates')
	await initTranslations('chat')
	const { setHubPane } = await import('./hubPane.mjs')
	setHubPane('nav')
	await loadViewerIdentity()
	await loadAliases().catch(() => {})
	try {
		const { loadGroups } = await import('./serverBar.mjs')
		await loadGroups()
	}
	catch (error) {
		hubStore.sidebar.groups = []
		handleUIError(error, 'chat.hub.loadGroupFailed')
	}
	await navigateHubFromLocation()
}
