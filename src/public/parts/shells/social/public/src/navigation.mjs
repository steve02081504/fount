import { parseEntityHash } from 'https://esm.sh/@steve02081504/fount-p2p/core/entity_id'
import { isHex64 } from 'https://esm.sh/@steve02081504/fount-p2p/core/hexIds'

import { parseSocialRunUri } from '../shared/runUri.mjs'

import { publishPost } from './composer.mjs'
import { state } from './state.mjs'
import { activateView, currentMainView, MAIN_NAV_VIEWS } from './viewChrome.mjs'
import { loadDrafts } from './views/drafts.mjs'
import { loadExplore } from './views/explore.mjs'
import { loadFeed, updateFeedSearchChrome } from './views/feed.mjs'
import { loadLiveView } from './views/live.mjs'
import { loadNotifications } from './views/notifications.mjs'
import { loadPostDetail } from './views/postDetail.mjs'
import { loadProfile, loadProfileFor, refreshProfilePosts } from './views/profile.mjs'
import { loadSaved } from './views/saved.mjs'
import { loadSearchView } from './views/search.mjs'
import { loadSettings } from './views/settings.mjs'
import { loadTopicView } from './views/topic.mjs'
import { loadVideoView } from './views/video.mjs'

/**
 * 打开分享帖时主动连分享者 / 作者节点（跳过本机）。
 * @param {string} entityHash 作者 entityHash
 * @param {string} [sharerNodeHash] 分享者 nodeHash
 * @returns {void}
 */
function connectNodesFromShare(entityHash, sharerNodeHash) {
	const targets = new Set()
	if (isHex64(sharerNodeHash)) targets.add(String(sharerNodeHash).toLowerCase())
	const parsed = parseEntityHash(entityHash)
	if (parsed?.nodeHash) targets.add(String(parsed.nodeHash).toLowerCase())
	const self = String(state.viewerNodeHash || '').toLowerCase()
	for (const targetNodeHash of targets) {
		if (!targetNodeHash || targetNodeHash === self) continue
		void fetch('/api/p2p/federation/connect-node', {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ targetNodeHash }),
		}).catch(() => {})
	}
}

/**
 * 将主导航视图同步到 location.hash（replace，避免历史堆叠）。
 * @param {string} view 视图名
 * @returns {void}
 */
function syncHashForMainView(view) {
	if (!MAIN_NAV_VIEWS.includes(view)) return
	const next = `#${view}`
	if (location.hash === next) return
	history.replaceState(null, '', `${location.pathname}${location.search}${next}`)
}

/**
 * 刷新当前可见视图中的帖子列表。
 * @returns {Promise<void>}
 */
export async function refreshVisiblePosts() {
	const feedVisible = !document.getElementById('feedView')?.classList.contains('hidden')
	const profileVisible = !document.getElementById('profileView')?.classList.contains('hidden')
	const postVisible = !document.getElementById('postDetailView')?.classList.contains('hidden')
	if (feedVisible)
		if (state.activeFeedSearchQuery) {
			const { loadSearchView } = await import('./views/search.mjs')
			await loadSearchView(state.activeFeedSearchQuery)
		}
		else {
			state.feedCursor = null
			await loadFeed(false)
		}

	if (profileVisible && state.profileEntityHash) {
		await refreshProfilePosts()
		const albumsPanel = document.getElementById('profileAlbumsPanel')
		if (albumsPanel && !albumsPanel.classList.contains('hidden')) {
			const { renderProfileAlbums } = await import('./views/albums.mjs')
			await renderProfileAlbums(state.profileEntityHash, albumsPanel)
		}
	}
	if (postVisible && state.postDetailEntityHash && state.postDetailPostId)
		await loadPostDetail(state.postDetailEntityHash, state.postDetailPostId)
}

/**
 * 切换主导航视图并加载对应数据。
 * @param {string} view 视图名
 * @param {{ skipHash?: boolean, focusEntityHash?: string, focusPostId?: string }} [options] skipHash 时不写 URL；videos 可带焦点帖
 * @returns {Promise<void>}
 */
export async function switchView(view, options = {}) {
	activateView(view)
	if (!options.skipHash)
		syncHashForMainView(view)
	if (view === 'feed') {
		if (state.activeFeedSearchQuery) {
			state.activeFeedSearchQuery = null
			const searchInput = document.getElementById('feedSearchInput')
			if (searchInput instanceof HTMLInputElement) searchInput.value = ''
		}
		state.feedCursor = null
		await loadFeed(false)
		updateFeedSearchChrome()
	}
	if (view === 'notifications') {
		state.notificationsCursor = null
		await loadNotifications(false)
	}
	if (view === 'explore') await loadExplore()
	if (view === 'saved') await loadSaved()
	if (view === 'drafts') await loadDrafts()
	if (view === 'settings') await loadSettings()
	if (view === 'profile') await loadProfile()
	if (view === 'videos')
		await loadVideoView({
			focusEntityHash: options.focusEntityHash,
			focusPostId: options.focusPostId,
		})
	if (view === 'live') await loadLiveView()
}

/**
 * 解析 URL/hash 深链并导航到对应视图。
 * @returns {Promise<boolean>} 是否已处理导航
 */
export async function applyIncomingNavigation() {
	const rawHash = window.location.hash.replace(/^#/, '')

	// 冒号分隔的自定义深链格式
	if (rawHash.startsWith('topic:')) {
		const tag = decodeURIComponent(rawHash.slice('topic:'.length))
		await loadTopicView(tag)
		return true
	}
	if (rawHash.startsWith('search:')) {
		const q = decodeURIComponent(rawHash.slice('search:'.length))
		await loadSearchView(q)
		return true
	}
	if (rawHash.startsWith('live:')) {
		const rest = rawHash.slice('live:'.length)
		const colonIdx = rest.indexOf(':')
		const entityHash = colonIdx >= 0 ? rest.slice(0, colonIdx) : rest
		const liveId = colonIdx >= 0 ? rest.slice(colonIdx + 1) : ''
		activateView('live')
		await loadLiveView(entityHash, liveId)
		return true
	}

	// 短视频深链：#videos;entityHash;postId
	if (rawHash.startsWith('videos;')) {
		const parts = rawHash.split(';')
		const focusEntityHash = (parts[1] || '').toLowerCase()
		const focusPostId = parts[2] || ''
		activateView('videos')
		await loadVideoView({ focusEntityHash, focusPostId })
		return true
	}

	// 主导航 tab：#feed / #videos / …
	if (MAIN_NAV_VIEWS.includes(rawHash)) {
		if (currentMainView() === rawHash) return true
		await switchView(rawHash, { skipHash: true })
		return true
	}

	// 分号分隔的原有深链格式
	const urlQ = new URLSearchParams(location.search).get('q')?.trim()
	const hashParsed = parseSocialRunUri(rawHash)
	if (hashParsed?.subcommand === 'search' && hashParsed.searchQuery) {
		const tag = hashParsed.searchQuery.trim()
		await loadSearchView(tag.startsWith('#') ? tag : `#${tag}`)
		return true
	}
	if (urlQ) {
		await loadSearchView(urlQ)
		return true
	}
	if (hashParsed?.subcommand === 'post' && hashParsed.entityHash && hashParsed.postId) {
		connectNodesFromShare(hashParsed.entityHash, hashParsed.sharerNodeHash)
		await loadPostDetail(hashParsed.entityHash.toLowerCase(), hashParsed.postId)
		return true
	}
	if (hashParsed?.entityHash && hashParsed.subcommand === 'profile') {
		activateView('profile')
		document.getElementById('composer')?.classList.add('hidden')
		await loadProfileFor(hashParsed.entityHash.toLowerCase(), hashParsed.postId || null)
		return true
	}
	return false
}

/**
 * 滚动到 composer 并聚焦输入框。
 * @param {{ switchToFeed?: boolean }} [options] 为 true 时 composer 隐藏则先切到 feed
 * @returns {Promise<void>}
 */
export async function focusComposer({ switchToFeed = false } = {}) {
	if (switchToFeed) await switchView('feed')
	document.getElementById('composer')?.scrollIntoView({ behavior: 'smooth' })
	document.getElementById('postText')?.focus()
}

/**
 * 发帖成功后刷新 feed 并清空搜索状态。
 * @returns {Promise<void>}
 */
export async function afterPublishPost() {
	await publishPost()
	state.activeFeedSearchQuery = null
	const searchInput = document.getElementById('feedSearchInput')
	if (searchInput instanceof HTMLInputElement) searchInput.value = ''
	state.feedCursor = null
	await loadFeed(false)
	updateFeedSearchChrome()
}
