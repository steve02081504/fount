/**
 * 【文件】public/hub/init.mjs
 * 【职责】Hub 主入口 bootstrap：i18n/模板/可信作者/deep link、挂载消息与 WS 回调、hash 导航、顶栏 persona 展示。
 * 【原理】注册 setGroupChannelRefreshHandler 等联邦流回调 → bindChannelMessageActions → navigateFromHash；
 *   refreshViewerHubPresentation 按 viewerEntityHash 拉 profile 更新顶栏头像；stopGeneration 绑定生成中止按钮。
 * 【数据结构】hubStore（core/state）持有 currentGroupId、viewerEntityHash、频道与管道上下文。
 * 【关联】hub 页面加载时调用；串联 messages、groupStream、hashNav、chat、presence、wireEvents。
 */
import { mountDockedEmojiPicker } from '../../../../pages/scripts/emojiPicker.mjs'
import { mountDockedStickerPicker } from '../../../../pages/scripts/stickerPicker.mjs'
import { initTranslations } from '../../../../scripts/i18n.mjs'
import { usingTemplates } from '../../../../scripts/template.mjs'
import { showToastI18n } from '../../../../scripts/toast.mjs'
import { fetchStickerPayload } from '../providers/sticker.mjs'
import { sendGroupMessage } from '../src/api/groupApi.mjs'
import { applyChatRunUri, runUriFromPageLocation } from '../src/deepLinkConsume.mjs'
import { setEmojiUrlResolver } from '../src/emojiCache.mjs'
import { localeQueryString } from '../src/entityProfileApi.mjs'
import { entityHashLabel } from '../src/lib/entityHash.mjs'
import { syncTrustedAuthorsFromShell } from '../src/trustedAuthors.mjs'
import { handleUIError } from '../src/ui/errors.mjs'

import { getChatGestures } from './chatGestures.mjs'
import { mountAvatarCover } from './core/avatarCover.mjs'
import { wireHubBannerBindings } from './core/bindings.mjs'
import { avatarColor, avatarInitial, escapeHtml } from './core/domUtils.mjs'
import { hubStore } from './core/state.mjs'
import { parseHash, updateFriendsHash } from './core/urlHash.mjs'
import {
	closeGroupWebSocket,
	getActiveVolatileStreamIds,
	resetVolatileStreamState,
	setGenerationActiveChangeHandler,
	setGroupChannelRefreshHandler,
	setGroupMessageDeleteHandler,
	setGroupMessageEditHandler,
	setGroupStreamEndHandler,
	setGroupThreadChannelRefreshHandler,
} from './groupStream.mjs'
import { navigateFromHash } from './hashNav.mjs'
import { setupHubNotifications } from './hubNotifications.mjs'
import { bindChannelMessageActions } from './messages/messageActionsHandlers.mjs'
import {
	applyChannelMessageDelete,
	applyChannelMessageEdit,
	cancelScheduledChannelRefresh,
	disableComposer,
	enableComposer,
	loadMessages,
	scheduleChannelIncrementalRefresh,
	scrollToBottom,
} from './messages/messages.mjs'
import { setupMisc } from './misc.mjs'
import { setActiveModeTab, setMode } from './mode.mjs'
import { applyAvatarsTo, fetchUserProfile } from './presence.mjs'
import {
	initPrivateGroup,
	setRefreshStopGenerationButton,
} from './privateGroup.mjs'
import { loadGroups } from './serverBar.mjs'
import { refreshActiveThreadIfOpen } from './threadDrawer.mjs'

/**
 * 用当前群 context 刷新顶栏展示名与头像（persona → 用户名 → 默认图）。
 * @returns {Promise<void>}
 */
export async function refreshViewerHubPresentation() {
	const entityHash = hubStore.viewerEntityHash
	if (!entityHash) return
	const profile = await fetchUserProfile(entityHash, {
		groupId: hubStore.currentGroupId || undefined,
		bypassCache: true,
	})
	const label = profile?.name || entityHashLabel(entityHash) || '?'
	hubStore.viewerDisplayName = label
	const myAvatar = document.getElementById('hub-my-avatar')
	const myName = document.getElementById('hub-my-name')
	if (!myAvatar || !myName) return
	myAvatar.replaceChildren()
	myAvatar.textContent = avatarInitial(label)
	myAvatar.style.background = avatarColor(label)
	myName.textContent = label
	if (profile?.avatar)
		await mountAvatarCover(myAvatar, profile.avatar, escapeHtml(label))
}

/** @returns {Promise<void>} 加载当前 viewer（nodeHash + entityHash）到顶栏 */
async function loadMe() {
	let data
	try {
		const qs = localeQueryString(hubStore.currentGroupId || undefined)
		const resp = await fetch(`/api/p2p/viewer${qs ? `?${qs}` : ''}`, { credentials: 'include' })
		if (!resp.ok) return
		data = await resp.json()
	} catch {
		return
	}
	hubStore.nodeHash = data.nodeHash || null
	hubStore.viewerEntityHash = data.viewerEntityHash || null
	await refreshViewerHubPresentation()
	if (!hubStore.viewerEntityHash) return
	const { syncViewerPresence, startIdleWatcher } = await import('./hubStatus.mjs')
	await syncViewerPresence(hubStore.viewerEntityHash)
	startIdleWatcher()
}

/** @returns {Promise<void>} 注册全局自定义表情 URL 解析器 */
async function wireCustomEmojiResolver() {
	const { listCustomEmojis } = await import('../src/customEmojis.mjs')
	/**
	 * @param {string} groupId 表情所属群
	 * @param {string} emojiId 表情 ID
	 * @returns {Promise<string|null>} data URL；未找到为 null
	 */
	setEmojiUrlResolver(async (groupId, emojiId) => {
		const entries = await listCustomEmojis()
		const saved = entries.find(entry => entry?.groupId === groupId && entry?.emojiId === emojiId)?.dataUrl
		if (saved) return saved
		const { fetchGroupEmojiDataUrl } = await import('../src/groupEmojiApi.mjs')
		return fetchGroupEmojiDataUrl(groupId, emojiId)
	})
}

/**
 * 好友私聊进入/退出（角色或用户）。
 * @param {object | null} peer `null` 退出；否则含 `entityHash`，角色另有 `charname`
 * @returns {void}
 */
function onEnterFriendChat(peer) {
	cancelScheduledChannelRefresh()
	closeGroupWebSocket()
	if (!peer?.entityHash) {
		hubStore.currentGroupId = null
		hubStore.currentChannelId = null
		hubStore.currentState = null
		updateFriendsHash()
		void setMode('friends')
		return
	}
	hubStore.currentMode = 'friends'
	setActiveModeTab('friends')
}

/** @returns {string|null} 当前用户名 */
function emojiGetUsername() {
	return hubStore.viewerEntityHash
}

/** @returns {{ groupId: string|null, channelId: string|null, privateGroupId: string|null }} 当前群/私聊上下文 */
function emojiGetContext() {
	const privateGroupId = hubStore.privateGroup.groupId
	const groupId = hubStore.currentGroupId || privateGroupId
	const channelId = hubStore.currentChannelId || hubStore.privateGroup.channelId
	return { groupId, channelId, privateGroupId }
}

/**
 * @returns {typeof hubStore.groups} 已加入群列表
 */
function hubPickerGetGroups() {
	return hubStore.groups
}

/**
 * 构建表情选择器上下文（每次打开 picker 时刷新当前群）。
 * @returns {{ groupId: string|null, getGroups: typeof hubPickerGetGroups }} 提供商上下文
 */
function hubEmojiPickerCtx() {
	return {
		groupId: emojiGetContext().groupId,
		getGroups: hubPickerGetGroups,
	}
}

/**
 * 群表情长按：作为贴纸消息发送。
 * @param {{ emojiRef?: string, emojiId?: string }} item - 选中的群表情。
 * @returns {Promise<void>}
 */
async function sendPickedEmojiAsSticker(item) {
	const { groupId, channelId } = emojiGetContext()
	if (!groupId || !channelId) return
	try {
		await sendGroupMessage(groupId, channelId, {
			type: 'sticker',
			emojiRef: item.emojiRef,
			stickerName: item.emojiId || 'emoji',
		})
		await loadMessages()
	}
	catch (err) {
		showToastI18n('error', 'chat.hub.sendStickerFailed', { error: err.message })
	}
}

/**
 * 选中收藏贴纸并发送到当前频道。
 * @param {{ stickerId?: string, stickerUrl?: string }} sticker - 贴纸条目。
 * @returns {Promise<void>}
 */
async function sendPickedHubSticker(sticker) {
	const { groupId, channelId } = emojiGetContext()
	if (!groupId || !channelId) return
	const { stickerId, stickerUrl } = sticker
	try {
		if (stickerUrl) {
			const { stickerBase64, mimeType } = await fetchStickerPayload(stickerUrl)
			await sendGroupMessage(groupId, channelId, {
				type: 'sticker',
				stickerId,
				stickerName: stickerId,
				mimeType,
				stickerBase64,
			})
			const username = emojiGetUsername()
			if (username)
				void fetch(`/api/parts/shells:chat/stickers/recent/${encodeURIComponent(stickerId)}`, {
					method: 'POST',
					credentials: 'include',
				})
			await loadMessages()
		}
		else
			showToastI18n('error', 'chat.hub.sendStickerFailed')
	}
	catch (err) {
		showToastI18n('error', 'chat.hub.sendStickerFailed', { error: err.message })
	}
}

/**
 * 挂载 Hub 停靠式表情/贴纸选择器（共享 picker + Chat provider）。
 * @returns {Promise<void>}
 */
async function wireHubPickers() {
	const emojiPickerEl = document.getElementById('hub-emoji-picker')
	const emojiTabsEl = document.getElementById('hub-emoji-tabs')
	const emojiGridEl = document.getElementById('hub-emoji-grid')
	const emojiButton = document.getElementById('hub-emoji-button')
	const stickerPickerEl = document.getElementById('hub-sticker-picker')
	const stickerGridEl = document.getElementById('hub-sticker-grid')
	const stickerButton = document.getElementById('hub-sticker-button')
	const messageInput = document.getElementById('hub-message-input')

	if (emojiPickerEl && emojiTabsEl && emojiGridEl && emojiButton) 
		await mountDockedEmojiPicker({
			pickerEl: emojiPickerEl,
			tabsEl: emojiTabsEl,
			gridEl: emojiGridEl,
			triggerBtn: emojiButton,
			inputEl: messageInput instanceof HTMLTextAreaElement ? messageInput : undefined,
			closeWhenOpening: stickerPickerEl,
			getCtx: hubEmojiPickerCtx,
			/**
			 *
			 */
			onInsert: () => {},
			onSendAsSticker: sendPickedEmojiAsSticker,
		})
	

	if (stickerPickerEl && stickerGridEl && stickerButton) 
		await mountDockedStickerPicker({
			pickerEl: stickerPickerEl,
			gridEl: stickerGridEl,
			triggerBtn: stickerButton,
			closeWhenOpening: emojiPickerEl,
			ctx: {},
			onSelect: sendPickedHubSticker,
		})
	
}

/** @returns {Promise<void>} Hub 页面入口初始化 */
export async function init() {
	usingTemplates('/parts/shells:chat/src/templates')
	await initTranslations('chat')
	setupMisc()
	setupHubNotifications()
	wireHubBannerBindings()

	/**
	 * 刷新停止生成按钮的可见状态。
	 * @returns {void}
	 */
	function refreshStopBtn() {
		const stopBtn = document.getElementById('hub-stop-generation-button')
		const sendBtn = document.getElementById('hub-send-button')
		const active = getActiveVolatileStreamIds().length > 0
		if (stopBtn) stopBtn.toggleAttribute('hidden', !active)
		if (sendBtn) sendBtn.removeAttribute('hidden')
	}

	setRefreshStopGenerationButton(refreshStopBtn)

	initPrivateGroup({
		enableComposer,
		disableComposer,
		scrollToBottom,
		applyAvatarsTo,
		onEnterPrivateGroup: onEnterFriendChat,
	})

	setGenerationActiveChangeHandler(refreshStopBtn)

	document.getElementById('hub-stop-generation-button')?.addEventListener('click', () => {
		resetVolatileStreamState({ abortBackend: true })
	})
	setGroupStreamEndHandler(async () => {
		if (hubStore.currentGroupId && hubStore.currentChannelId)
			await scheduleChannelIncrementalRefresh({ immediate: true })
		const container = document.getElementById('hub-messages')
		if (container instanceof HTMLElement)
			getChatGestures().attachLastCharMessageSwipe(container)
		scrollToBottom()
	})
	setGroupChannelRefreshHandler((options = {}) => {
		if (hubStore.currentGroupId && hubStore.currentChannelId)
			scheduleChannelIncrementalRefresh(options)
	})
	setGroupThreadChannelRefreshHandler(() => {
		void refreshActiveThreadIfOpen()
	})
	setGroupMessageEditHandler(async targetId => {
		if (hubStore.currentGroupId && hubStore.currentChannelId)
			await applyChannelMessageEdit(targetId)
		await refreshActiveThreadIfOpen()
	})
	setGroupMessageDeleteHandler(async targetId => {
		if (hubStore.currentGroupId && hubStore.currentChannelId)
			await applyChannelMessageDelete(targetId)
		await refreshActiveThreadIfOpen()
	})

	const messagesRoot = document.getElementById('hub-messages')
	if (messagesRoot) bindChannelMessageActions(messagesRoot)
	void wireHubPickers()
	void syncTrustedAuthorsFromShell()
	await wireCustomEmojiResolver()
	await loadMe()
	try {
		await loadGroups()
	}
	catch (error) {
		hubStore.groups = []
		handleUIError(error, 'chat.hub.loadGroupFailed')
	}
	const { refreshMailboxBanner } = await import('./banners.mjs')
	void refreshMailboxBanner()

	const urlParams = new URLSearchParams(window.location.search)
	const charParam = urlParams.get('char')
	const contactParam = urlParams.get('contact')
	const hashRaw = window.location.hash.slice(1)
	let { groupId, channelId } = parseHash()

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

	if (contactParam && !hashRaw.startsWith('group:')) {
		const { applyHubContactQuery } = await import('./hubContact.mjs')
		const handled = await applyHubContactQuery(contactParam)
		if (handled) {
			const clean = new URL(window.location.href)
			clean.searchParams.delete('contact')
			window.history.replaceState(null, '', `${clean.pathname}${clean.search}${clean.hash}`)
		}
		else
			await navigateFromHash()
	}
	else if (charParam && !hashRaw.startsWith('group:')) {
		await setMode('friends')
		const { enterFriendChat } = await import('./friendChat.mjs')
		const { buildCharFriendBinding } = await import('../src/friendBinding.mjs')
		const { nodeHash } = hubStore
		if (nodeHash)
			await enterFriendChat({ binding: await buildCharFriendBinding(nodeHash, charParam) })
		else
			await setMode('friends')
	}
	else
		await navigateFromHash()
}
