import { wireEmojiPickerButton } from '../../../../scripts/emojiPicker.mjs'
import { createReadyGateFor, SOCIAL_APP_GATE } from '../../../../scripts/readyGate.mjs'
import { showToastI18n } from '../../../../scripts/toast.mjs'

import { handleMainClick } from './actions.mjs'
import {
	addComposerMedia,
	loadGroupPickerOptions,
	loadPostingEntities,
	refreshGroupRefPreview,
	setPendingGroupRef,
	syncGroupRefInComposer,
} from './composer.mjs'
import { groupRefLabel } from './lib/groupRef.mjs'
import { attachMentionAutocomplete } from './mentionAutocomplete.mjs'
import { applyIncomingNavigation, afterPublishPost, switchView } from './navigation.mjs'
import { loadFeed, runFeedSearch } from './views/feed.mjs'
import { updateNotificationBadge } from './views/notifications.mjs'
import { confirmSaveModal, closeSaveModal } from './views/saved.mjs'

const socialGate = createReadyGateFor(SOCIAL_APP_GATE, 'Social')

const FEED_WS_TIMEOUT_MS = 30_000

/**
 * 建立 feed WebSocket 并等待 open。
 * @param {object} appContext 应用上下文
 * @returns {Promise<WebSocket>} 已 open 的 feed WebSocket
 */
function connectFeedWebSocket(appContext) {
	const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/parts/shells:social/feed`
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url)
		const timer = setTimeout(() => {
			ws.close()
			reject(new Error('feed WebSocket open timeout'))
		}, FEED_WS_TIMEOUT_MS)
		ws.addEventListener('open', () => {
			clearTimeout(timer)
			resolve(ws)
		}, { once: true })
		ws.addEventListener('error', () => {
			clearTimeout(timer)
			reject(new Error('feed WebSocket failed'))
		}, { once: true })
		ws.addEventListener('message', event => {
			let msg = null
			try { msg = JSON.parse(event.data) } catch { /* ignore */ }
			if (msg?.type === 'hello') return
			const feedVisible = !document.getElementById('feedView')?.classList.contains('hidden')
			if (feedVisible && !appContext.state.activeFeedSearchQuery)
				void loadFeed(appContext, false, { skipSync: true })
			else if (feedVisible && appContext.state.activeFeedSearchQuery)
				void runFeedSearch(appContext)
			void updateNotificationBadge(appContext)
		})
	})
}

/**
 * 初始化 Social 前端：绑定事件、加载选项并建立 WebSocket feed 连接。
 * @param {object} appContext 应用上下文
 * @returns {Promise<void>}
 */
export async function bootstrapSocialApp(appContext) {
	socialGate.markPending()
	try {
		document.getElementById('postBtn')?.addEventListener('click', () => { void afterPublishPost(appContext) })
		const postText = document.getElementById('postText')
		wireEmojiPickerButton(document.getElementById('emojiPickBtn'), token => {
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
			await addComposerMedia(appContext, input.files)
			input.value = ''
		})
		document.getElementById('feedLoadMore')?.addEventListener('click', () => { void loadFeed(appContext, true) })
		document.querySelector('main')?.addEventListener('click', event => { void handleMainClick(appContext, event) })
		document.getElementById('saveModal')?.addEventListener('click', async event => {
			const { target } = event
			if (!(target instanceof HTMLElement)) return
			if (target.id === 'saveConfirmBtn')
				await confirmSaveModal(appContext)
			if (target.id === 'saveCancelBtn')
				closeSaveModal(appContext)
		})
		for (const button of document.querySelectorAll('.nav-btn'))
			button.addEventListener('click', () => { void switchView(appContext, button.dataset.view) })

		await loadPostingEntities(appContext)
		await loadGroupPickerOptions(appContext)
		await updateNotificationBadge(appContext)

		const viewer = await appContext.socialApi('/viewer')
		appContext.state.viewerEntityHash = viewer.viewerEntityHash ?? null

		for (const [id, key] of Object.entries({
			linkGroupSelect: 'social.a11y.linkGroupSelect',
			postAsEntity: 'social.a11y.postAsEntity',
			postVisibility: 'social.a11y.postVisibility',
			postLang: 'social.a11y.postLang',
			feedTrending: 'social.a11y.trendingHashtags',
			saveFolderSelect: 'social.a11y.saveFolderSelect',
		})) {
			const el = document.getElementById(id)
			if (el) el.setAttribute('aria-label', appContext.geti18n(key))
		}

		document.getElementById('linkGroupSelect')?.addEventListener('change', event => {
			const select = event.target
			if (!(select instanceof HTMLSelectElement) || !select.value) {
				appContext.state.pendingGroupRef = null
				syncGroupRefInComposer(appContext, null)
				refreshGroupRefPreview(appContext)
				return
			}
			const [groupId, channelId] = select.value.split('\t')
			if (!groupId) return
			const label = select.selectedOptions[0]?.textContent
			|| groupRefLabel({ groupId, channelId })
			setPendingGroupRef(appContext, groupId, channelId, label)
		})

		if (!await applyIncomingNavigation(appContext))
			await switchView(appContext, 'feed')

		window.addEventListener('hashchange', () => {
			void applyIncomingNavigation(appContext)
		})

		document.getElementById('feedSearchInput')?.addEventListener('keydown', event => {
			if (event.key === 'Enter') {
				event.preventDefault()
				void runFeedSearch(appContext)
			}
		})

		socialGate.markReady()
		void connectFeedWebSocket(appContext).catch(err => {
			console.error(err)
		})
	}
	catch (error) {
		socialGate.markFailed(error)
		const err = error instanceof Error ? error : new Error(String(error))
		console.error(err)
		showToastI18n('social.bootstrapFailed', { error: err.message })
		throw error
	}
}
