import { wireEmojiPickerButton } from '../../../../scripts/components/emojiPicker.mjs'
import { createReadyGate } from '/scripts/test/ready_gate.mjs'
import { loadAliases } from '/parts/shells:chat/shared/aliases.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { groupRefLabel } from '../shared/groupRef.mjs'

import { handleMainClick } from './actions.mjs'
import {
	addComposerMedia,
	initComposerVisibilityPicker,
	loadAlbumPickerOptions,
	loadGroupPickerOptions,
	refreshGroupRefPreview,
	setPendingGroupRef,
	syncGroupRefInComposer,
} from './composer.mjs'
import { SOCIAL_GATE } from './gate.mjs'
import { chatApi } from './lib/apiClient.mjs'
import { renderAvatarHtml, rememberEntityHandle } from './lib/display.mjs'
import { wireSocialProfileHover } from './lib/profileHover.mjs'
import { bindMediaCarousel } from './mediaRender.mjs'
import { attachMentionAutocomplete } from './mentionAutocomplete.mjs'
import { bindContentReveal } from '/scripts/features/contentReveal/index.mjs'
import { geti18n, primaryLocale } from '/scripts/i18n/index.mjs'
import { applyIncomingNavigation, afterPublishPost, focusComposer, switchView } from './navigation.mjs'
import { state } from './state.mjs'
import { prependFeedItem, showFeedNewPostsBanner, updateFeedSearchChrome } from './views/feed.mjs'
import { initLiveBroadcastView } from './views/live.mjs'
import { bumpNotificationBadge, mergeIncomingNotification, updateNotificationBadge } from './views/notifications.mjs'
import { confirmSaveModal, closeSaveModal } from './views/saved.mjs'
import { initSearchView, loadSearchView } from './views/search.mjs'
import { initTopicView } from './views/topic.mjs'
import { handleVideoKeydown } from './views/video.mjs'

const socialGate = createReadyGate(SOCIAL_GATE)

const FEED_WS_TIMEOUT_MS = 30_000
const FEED_WS_RECONNECT_MAX_MS = 30_000

/**
 * 处理 feed WebSocket 消息。
 * @param {object | null} message 解析后的 WS 载荷
 * @returns {void}
 */
function handleFeedWebSocketMessage(message) {
	if (!message?.type || message.type === 'hello') return
	if (message.type === 'post') {
		if (message.item) {
			void prependFeedItem(message.item).then(inserted => {
				if (!inserted) showFeedNewPostsBanner()
			})
			return
		}
		showFeedNewPostsBanner()
	}
	else if (message.type === 'notification') {
		if (!mergeIncomingNotification(message.notification))
			bumpNotificationBadge()
	}
	else {
		const feedVisible = !document.getElementById('feedView')?.classList.contains('hidden')
		if (feedVisible && !state.activeFeedSearchQuery)
			showFeedNewPostsBanner()
	}
}

/**
 * 建立 feed WebSocket（带断线重连）。
 * @param {number} [attempt=0] 重连次数
 * @returns {void}
 */
function connectFeedWebSocket(attempt = 0) {
	const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/parts/shells:social/feed`
	const ws = new WebSocket(url)
	state.feedWs = ws
	const timer = setTimeout(() => {
		ws.close()
	}, FEED_WS_TIMEOUT_MS)
	ws.addEventListener('open', () => {
		clearTimeout(timer)
		state.feedWsAttempt = 0
	}, { once: true })
	ws.addEventListener('error', () => {
		clearTimeout(timer)
	}, { once: true })
	ws.addEventListener('message', event => {
		let message = null
		try { message = JSON.parse(event.data) } catch { /* ignore */ }
		handleFeedWebSocketMessage(message)
	})
	ws.addEventListener('close', () => {
		if (state.feedWs !== ws) return
		state.feedWs = null
		const nextAttempt = (state.feedWsAttempt ?? attempt) + 1
		state.feedWsAttempt = nextAttempt
		const delay = Math.min(FEED_WS_RECONNECT_MAX_MS, 1000 * 2 ** Math.min(nextAttempt, 5))
		setTimeout(() => connectFeedWebSocket(nextAttempt), delay)
	})
}

/**
 * 初始化 Social 前端：绑定事件、加载选项并建立 WebSocket feed 连接。
 * @returns {Promise<void>}
 */
export async function bootstrap() {
	socialGate.markPending()
	try {
		await loadAliases().catch(() => {})
		document.getElementById('postButton')?.addEventListener('click', () => { void afterPublishPost() })
		document.getElementById('composeNavButton')?.addEventListener('click', () => {
			void focusComposer({ switchToFeed: true })
		})
		document.getElementById('composeFab')?.addEventListener('click', () => {
			void focusComposer({ switchToFeed: true })
		})
		document.getElementById('feedSearchOpenButton')?.addEventListener('click', () => {
			void loadSearchView()
		})
		const postText = document.getElementById('postText')
		wireEmojiPickerButton(document.getElementById('emojiPickButton'), token => {
			if (!(postText instanceof HTMLTextAreaElement)) return
			const start = postText.selectionStart ?? postText.value.length
			const end = postText.selectionEnd ?? start
			postText.value = postText.value.slice(0, start) + token + postText.value.slice(end)
			postText.selectionStart = postText.selectionEnd = start + token.length
			postText.focus()
		})
		attachMentionAutocomplete(document.getElementById('postText'))
		document.getElementById('mediaInput')?.addEventListener('change', async event => {
			const input = event.target
			if (!(input instanceof HTMLInputElement) || !input.files?.length) return
			await addComposerMedia(input.files)
			input.value = ''
		})
		const shellRoot = document.getElementById('shell')
		shellRoot?.addEventListener('click', event => { void handleMainClick(event) })
		bindContentReveal(shellRoot)
		bindMediaCarousel(shellRoot)
		shellRoot?.addEventListener('click', event => {
			const { target } = event
			if (!(target instanceof HTMLElement)) return
			const cwReveal = target.closest('.content-warning-reveal')
			if (cwReveal) {
				const wrap = cwReveal.closest('.content-warning-wrap')
				queueMicrotask(async () => {
					const { playRevealedPostVideos } = await import('./lib/videoAutoplay.mjs')
					playRevealedPostVideos(wrap?.querySelector('.content-warning-body') || wrap)
				})
				return
			}
			const sensitiveReveal = target.closest('.sensitive-media-reveal')
			if (sensitiveReveal) {
				const wrap = sensitiveReveal.closest('.sensitive-media-wrap')
				queueMicrotask(async () => {
					const { playRevealedPostVideos } = await import('./lib/videoAutoplay.mjs')
					playRevealedPostVideos(wrap)
				})
			}
		})
		document.getElementById('saveModal')?.addEventListener('click', async event => {
			const { target } = event
			if (!(target instanceof HTMLElement)) return
			if (target.closest('#saveConfirmButton'))
				await confirmSaveModal()
			if (target.closest('#saveCancelButton'))
				closeSaveModal()
		})
		for (const button of document.querySelectorAll('.nav-btn[data-view]'))
			button.addEventListener('click', () => { void switchView(button.dataset.view) })

		const postLocale = document.getElementById('postLocale')
		if (postLocale instanceof HTMLInputElement)
			postLocale.value = primaryLocale()

		initComposerVisibilityPicker()
		await loadGroupPickerOptions()
		await loadAlbumPickerOptions()
		await updateNotificationBadge()

		const viewer = await chatApi('/viewer')
		state.viewerEntityHash = viewer.viewerEntityHash ?? null
		state.viewerNodeHash = viewer.nodeHash ?? null
		state.viewerDisplayName = viewer.profile?.name || null
		state.viewerProfile = viewer.profile
			? {
				name: viewer.profile.name || null,
				handle: viewer.profile.handle || null,
				avatar: viewer.profile.avatar || null,
				infoDefaults: viewer.profile.infoDefaults
					? { avatar: viewer.profile.infoDefaults.avatar || '' }
					: null,
			}
			: { name: state.viewerDisplayName }
		if (state.viewerEntityHash)
			rememberEntityHandle(state.viewerEntityHash, state.viewerProfile)
		const avatarSlot = document.getElementById('viewerComposerAvatar')
		if (avatarSlot && state.viewerEntityHash)
			avatarSlot.innerHTML = renderAvatarHtml(state.viewerEntityHash, state.viewerProfile)

		for (const [id, key] of Object.entries({
			linkGroupSelect: 'social.a11y.linkGroupSelect',
			postVisibility: 'social.a11y.postVisibility',
			postLocale: 'social.a11y.postLang',
			feedTrending: 'social.a11y.trendingHashtags',
			saveFolderSelect: 'social.a11y.saveFolderSelect',
			feedRefreshButton: 'social.feed.refresh',
			feedSearchClearButton: 'social.search.clear',
		})) {
			const el = document.getElementById(id)
			if (el) el.setAttribute('aria-label', geti18n(key))
		}
		const refreshButton = document.getElementById('feedRefreshButton')
		if (refreshButton) {
			const refreshLabel = geti18n('social.feed.refresh')
			refreshButton.setAttribute('data-tip', refreshLabel)
			refreshButton.setAttribute('title', refreshLabel)
		}

		document.getElementById('linkGroupSelect')?.addEventListener('change', event => {
			const select = event.target
			if (!(select instanceof HTMLSelectElement) || !select.value) {
				state.pendingGroupRef = null
				syncGroupRefInComposer(null)
				refreshGroupRefPreview()
				return
			}
			const [groupId, channelId] = select.value.split('\t')
			if (!groupId) return
			const label = select.selectedOptions[0]?.textContent
			|| groupRefLabel({ groupId, channelId })
			setPendingGroupRef(groupId, channelId, label)
		})

		// 初始化新视图
		initSearchView()
		initTopicView()
		initLiveBroadcastView()
		wireSocialProfileHover()

		// 视频视图键盘导航
		document.getElementById('videosView')?.addEventListener('keydown', handleVideoKeydown)
		document.getElementById('videosViewBackButton')?.addEventListener('click', () => {
			void switchView('feed')
		})
		document.getElementById('liveViewBackButton')?.addEventListener('click', () => {
			void switchView('feed')
		})

		if (!await applyIncomingNavigation())
			await switchView('feed')

		window.addEventListener('hashchange', () => {
			void applyIncomingNavigation()
		})

		document.getElementById('feedSearchInput')?.addEventListener('keydown', event => {
			if (event.key === 'Enter') {
				event.preventDefault()
				const input = event.target
				const q = input instanceof HTMLInputElement ? input.value.trim() : ''
				void loadSearchView(q)
			}
		})

		document.getElementById('feedSearchClearButton')?.addEventListener('click', () => {
			const input = document.getElementById('feedSearchInput')
			if (input instanceof HTMLInputElement) input.value = ''
			const searchInput = document.querySelector('#searchView #searchViewInput')
			if (searchInput instanceof HTMLInputElement) searchInput.value = ''
			state.activeFeedSearchQuery = null
			updateFeedSearchChrome()
			void switchView('feed')
		})

		document.getElementById('feedSearchInput')?.addEventListener('input', event => {
			const input = event.target
			if (!(input instanceof HTMLInputElement)) return
			document.getElementById('feedSearchClearButton')?.classList.toggle('hidden', !input.value.trim())
		})

		socialGate.markReady()
		connectFeedWebSocket()
	}
	catch (error) {
		socialGate.markFailed(error)
		const err = error instanceof Error ? error : new Error(String(error))
		console.error(err)
		showToastI18n('social.bootstrapFailed', { error: err.message })
		throw error
	}
}
