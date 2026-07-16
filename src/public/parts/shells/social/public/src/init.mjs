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
import { SOCIAL_APP_GATE } from './gate.mjs'
import { socialApi } from './lib/apiClient.mjs'
import { renderAvatarHtml } from './lib/display.mjs'
import { bindMediaCarousel } from './mediaRender.mjs'
import { attachMentionAutocomplete } from './mentionAutocomplete.mjs'
import { bindContentReveal } from '/scripts/features/contentReveal/index.mjs'
import { applyIncomingNavigation, afterPublishPost, switchView } from './navigation.mjs'
import { socialState } from './state.mjs'
import { runFeedSearch, prependFeedItem, showFeedNewPostsBanner } from './views/feed.mjs'
import { initLiveBroadcastView } from './views/live.mjs'
import { bumpNotificationBadge, mergeIncomingNotification, updateNotificationBadge } from './views/notifications.mjs'
import { confirmSaveModal, closeSaveModal } from './views/saved.mjs'
import { initSearchView } from './views/search.mjs'
import { initTopicView } from './views/topic.mjs'
import { handleVideoKeydown } from './views/video.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'

const socialGate = createReadyGate(SOCIAL_APP_GATE)

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
		if (feedVisible && !socialState.activeFeedSearchQuery)
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
	socialState.feedWs = ws
	const timer = setTimeout(() => {
		ws.close()
	}, FEED_WS_TIMEOUT_MS)
	ws.addEventListener('open', () => {
		clearTimeout(timer)
		socialState.feedWsAttempt = 0
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
		if (socialState.feedWs !== ws) return
		socialState.feedWs = null
		const nextAttempt = (socialState.feedWsAttempt ?? attempt) + 1
		socialState.feedWsAttempt = nextAttempt
		const delay = Math.min(FEED_WS_RECONNECT_MAX_MS, 1000 * 2 ** Math.min(nextAttempt, 5))
		setTimeout(() => connectFeedWebSocket(nextAttempt), delay)
	})
}

/**
 * 初始化 Social 前端：绑定事件、加载选项并建立 WebSocket feed 连接。
 * @returns {Promise<void>}
 */
export async function bootstrapSocialApp() {
	socialGate.markPending()
	try {
		await loadAliases().catch(() => {})
		document.getElementById('postButton')?.addEventListener('click', () => { void afterPublishPost() })
		document.getElementById('composeNavButton')?.addEventListener('click', () => {
			void switchView('feed')
			document.getElementById('composer')?.scrollIntoView({ behavior: 'smooth' })
			document.getElementById('postText')?.focus()
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
		const appRoot = document.getElementById('app')
		appRoot?.addEventListener('click', event => { void handleMainClick(event) })
		bindContentReveal(appRoot)
		bindMediaCarousel(appRoot)
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
			postLocale.value = navigator.language || 'zh-CN'

		initComposerVisibilityPicker()
		await loadGroupPickerOptions()
		await loadAlbumPickerOptions()
		await updateNotificationBadge()

		const viewer = await socialApi('/viewer')
		socialState.viewerEntityHash = viewer.viewerEntityHash ?? null
		socialState.viewerDisplayName = viewer.operator?.displayName
			|| viewer.profile?.name
			|| null
		socialState.agents = Array.isArray(viewer.agents) ? viewer.agents : []
		const avatarSlot = document.getElementById('viewerComposerAvatar')
		if (avatarSlot && socialState.viewerEntityHash)
			avatarSlot.innerHTML = renderAvatarHtml(socialState.viewerEntityHash, {
				name: socialState.viewerDisplayName,
			})

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
				socialState.pendingGroupRef = null
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

		// 视频视图键盘导航
		document.getElementById('videoView')?.addEventListener('keydown', handleVideoKeydown)
		document.getElementById('videoViewBackButton')?.addEventListener('click', () => {
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
				if (q.length >= 2)
					void switchView('feed')
				void runFeedSearch()
			}
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
