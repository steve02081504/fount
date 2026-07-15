import { parseSocialRunUri } from '../../shared/runUri.mjs'

import { publishPost } from './composer.mjs'
import { activateView } from './viewChrome.mjs'
import { loadExplore } from './views/explore.mjs'
import { loadFeed, openSearchView, runFeedSearch, updateFeedSearchChrome } from './views/feed.mjs'
import { loadLiveView } from './views/live.mjs'
import { loadNotifications } from './views/notifications.mjs'
import { loadProfile, loadProfileFor, refreshProfilePosts } from './views/profile.mjs'
import { loadSaved } from './views/saved.mjs'
import { loadSearchView } from './views/search.mjs'
import { loadTaste } from './views/taste.mjs'
import { loadTopicView } from './views/topic.mjs'
import { loadVideoView } from './views/video.mjs'

/**
 * 刷新当前可见视图中的帖子列表。
 * @param {object} appContext 应用上下文
 * @returns {Promise<void>}
 */
export async function refreshVisiblePosts(appContext) {
	const feedVisible = !document.getElementById('feedView')?.classList.contains('hidden')
	const profileVisible = !document.getElementById('profileView')?.classList.contains('hidden')
	if (feedVisible)
		if (appContext.state.activeFeedSearchQuery)
			await runFeedSearch(appContext)
		else {
			appContext.state.feedCursor = null
			await loadFeed(appContext, false)
		}

	if (profileVisible && appContext.state.profileEntityHash)
		await refreshProfilePosts(appContext)
}

/**
 * 切换主导航视图并加载对应数据。
 * @param {object} appContext 应用上下文
 * @param {string} view 视图名
 * @returns {Promise<void>}
 */
export async function switchView(appContext, view) {
	activateView(view)
	if (view === 'feed') {
		if (!appContext.state.activeFeedSearchQuery) {
			appContext.state.feedCursor = null
			await loadFeed(appContext, false)
		}
		updateFeedSearchChrome(appContext)
	}
	if (view === 'notifications') {
		appContext.state.notificationsCursor = null
		await loadNotifications(appContext, false)
	}
	if (view === 'explore') await loadExplore(appContext)
	if (view === 'saved') await loadSaved(appContext)
	if (view === 'taste') await loadTaste(appContext)
	if (view === 'profile') await loadProfile(appContext)
	if (view === 'videos') await loadVideoView(appContext)
	if (view === 'live') await loadLiveView(appContext)
}

/**
 * 解析 URL/hash 深链并导航到对应视图。
 * @param {object} appContext 应用上下文
 * @returns {Promise<boolean>} 是否已处理导航
 */
export async function applyIncomingNavigation(appContext) {
	const rawHash = window.location.hash.replace(/^#/, '')

	// 冒号分隔的自定义深链格式
	if (rawHash === 'videos') {
		await switchView(appContext, 'videos')
		return true
	}
	if (rawHash.startsWith('topic:')) {
		const tag = decodeURIComponent(rawHash.slice('topic:'.length))
		await loadTopicView(appContext, tag)
		return true
	}
	if (rawHash.startsWith('search:')) {
		const q = decodeURIComponent(rawHash.slice('search:'.length))
		await loadSearchView(appContext, q)
		return true
	}
	if (rawHash.startsWith('live:')) {
		const rest = rawHash.slice('live:'.length)
		const colonIdx = rest.indexOf(':')
		const entityHash = colonIdx >= 0 ? rest.slice(0, colonIdx) : rest
		const liveId = colonIdx >= 0 ? rest.slice(colonIdx + 1) : ''
		activateView('live')
		await loadLiveView(appContext, entityHash, liveId)
		return true
	}

	// 分号分隔的原有深链格式
	const urlQ = new URLSearchParams(location.search).get('q')?.trim()
	const hashParsed = parseSocialRunUri(rawHash)
	if (hashParsed?.subcommand === 'search' && hashParsed.searchQuery) {
		const tag = hashParsed.searchQuery.trim()
		await openSearchView(appContext, tag.startsWith('#') ? tag : `#${tag}`)
		return true
	}
	if (urlQ) {
		await openSearchView(appContext, urlQ)
		return true
	}
	if (hashParsed?.entityHash && hashParsed.subcommand === 'profile') {
		const viewer = await appContext.socialApi('/viewer').catch(() => ({ viewerEntityHash: null }))
		appContext.state.viewerEntityHash = viewer.viewerEntityHash
		activateView('profile')
		document.getElementById('composer')?.classList.add('hidden')
		await loadProfileFor(appContext, hashParsed.entityHash.toLowerCase(), hashParsed.postId || null)
		return true
	}
	return false
}

/**
 * 发帖成功后刷新 feed 并清空搜索状态。
 * @param {object} appContext 应用上下文
 * @returns {Promise<void>}
 */
export async function afterPublishPost(appContext) {
	await publishPost(appContext)
	appContext.state.activeFeedSearchQuery = null
	const searchInput = document.getElementById('feedSearchInput')
	if (searchInput instanceof HTMLInputElement) searchInput.value = ''
	appContext.state.feedCursor = null
	await loadFeed(appContext, false)
	updateFeedSearchChrome(appContext)
}
