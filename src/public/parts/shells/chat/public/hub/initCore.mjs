/**
 * 【文件】public/hub/initCore.mjs
 * 【职责】Hub 轻量引导：i18n、群列表与 hash 导航，不阻塞于 messages 重模块图。
 * 【关联】init.mjs（重型特性延后）、wireBootstrap、hashNav
 */
import { usingTemplates } from '../../../../scripts/features/template.mjs'
import { initTranslations } from '../../../../scripts/i18n/index.mjs'
import { handleUIError } from '../src/ui/errors.mjs'

import { hubStore } from './core/state.mjs'
import { parseHash } from './core/urlHash.mjs'

/** @returns {Promise<void>} 拉取 viewer 到 hubStore（顶栏详情由 init.mjs 补全） */
async function loadViewerIdentity() {
	const resp = await fetch('/api/p2p/viewer', { credentials: 'include' })
	if (!resp.ok) return
	const data = await resp.json()
	hubStore.viewer.nodeHash = data.nodeHash || null
	hubStore.viewer.operatorEntityHash = data.viewerEntityHash || null
	hubStore.viewer.viewerEntityHash = data.viewerEntityHash || null
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
			window.history.replaceState(null, '', `${clean.pathname}${clean.search}#group:${encodeURIComponent(groupId)}:${channelId || 'default'}`)
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
		if (hubStore.viewer.nodeHash)
			await enterFriendChat({ binding: await buildCharFriendBinding(hubStore.viewer.nodeHash, charParam) })
		return
	}

	await navigateFromHash()
}

/** @returns {Promise<void>} Hub 壳层就绪：翻译、群列表与 hash 导航 */
export async function initCore() {
	usingTemplates('/parts/shells:chat/src/templates')
	await initTranslations('chat')
	await loadViewerIdentity()
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
