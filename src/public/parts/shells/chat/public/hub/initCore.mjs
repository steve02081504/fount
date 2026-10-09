/**
 * 【文件】public/hub/initCore.mjs
 * 【职责】Hub 轻量引导：i18n、群列表与 hash 导航，不阻塞于 messages 重模块图。
 * 【关联】init.mjs（重型特性延后）、wireBootstrap、hashNav
 */
import { initTranslations } from '../../../../scripts/i18n/index.mjs'
import { loadAliases } from '../shared/aliases.mjs'
import { getViewer } from '../src/endpoints/viewer.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { whoami } from '/scripts/endpoints/base.mjs'

import { store } from './core/state.mjs'
import { parseHash } from './core/urlHash.mjs'

/** @returns {Promise<void>} 拉取 viewer 到 store（顶栏详情由 init.mjs 补全） */
async function loadViewerIdentity() {
	const [viewer, identity] = await Promise.all([
		getViewer().catch(error => { handleError('chat.hub.operationFailed')(error); return null }),
		whoami().catch(error => { handleError('chat.hub.operationFailed')(error); return null }),
	])
	if (identity?.username) store.viewer.username = identity.username
	if (!viewer) return
	store.viewer.nodeHash = viewer.nodeHash || null
	store.viewer.operatorEntityHash = viewer.viewerEntityHash || null
	store.viewer.viewerEntityHash = viewer.viewerEntityHash || null
	store.viewer.ownerEntityHash = viewer.profile?.ownerEntityHash || null
	store.viewer.agents = viewer.agents || []
	const { ingestAgentEntityHashList } = await import('./core/domUtils.mjs')
	ingestAgentEntityHashList(store.viewer.agents)
}

/**
 * @param {{ groupsLoaded: boolean }} options 引导阶段的群列表加载结果
 * @returns {Promise<void>} 按 URL 进入好友/群频道视图
 */
async function navigateHubFromLocation({ groupsLoaded }) {
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
			handleError('chat.hub.load.groupFailed')(e)
		}
		if (applied?.groupId) {
			groupsLoaded = false // run URI 可能刚刚加入/创建了群，导航前需重新拉取。
			groupId = applied.groupId
			channelId = applied.channelId || channelId
			const clean = new URL(window.location.href)
			clean.searchParams.delete('url')
			clean.searchParams.delete('run')
			let hash = `group:${encodeURIComponent(groupId)}`
			if (channelId) hash += `:${encodeURIComponent(channelId)}`
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
		const { charFriendBindingInput } = await import('../shared/friendBinding.mjs')
		await enterFriendChat({ binding: charFriendBindingInput(charParam) })
		return
	}

	await navigateFromHash({ groupsLoaded })
}

/** @returns {Promise<void>} Hub 壳层就绪：翻译、群列表与 hash 导航 */
export async function initCore() {
	await initTranslations('chat')
	const { setHubPane } = await import('./hubPane.mjs')
	setHubPane('nav')
	// API 请求期间并行下载导航模块，避免身份、别名与模块图逐段串行等待。
	const aliasesReady = loadAliases().catch(handleError('chat.hub.operationFailed'))
	const groupsReady = import('./serverBar.mjs').then(async ({ loadGroups }) => {
		await loadGroups({ beforeRender: aliasesReady })
		return true
	}).catch(error => {
		store.sidebar.groups = []
		handleError('chat.hub.load.groupFailed')(error)
		return false
	})
	const [, groupsLoaded] = await Promise.all([
		loadViewerIdentity(),
		groupsReady,
		aliasesReady,
		import('./hashNav.mjs'),
	])
	await navigateHubFromLocation({ groupsLoaded })
}
