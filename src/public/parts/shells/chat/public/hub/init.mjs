/**
 * 【文件】public/hub/init.mjs
 * 【职责】Hub 主入口 bootstrap：i18n/模板/可信作者/deep link、挂载消息与导航、顶栏 persona 展示。
 * 【原理】bindChannelMessageActions；导航由 initCore 完成。刷新顶栏与停止生成按钮直接调用模块导出。
 * 【数据结构】hubStore（core/state）持有 currentGroupId、viewerEntityHash、频道上下文。
 * 【关联】hub 页面加载时调用；串联 messages、stream、hashNav、chat、presence、wireEvents。
 */
import { mountDockedEmojiPicker } from '../../../../scripts/components/emojiPicker.mjs'
import { mountDockedStickerPicker } from '../../../../scripts/components/stickerPicker.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { fetchStickerPayload } from '../providers/sticker.mjs'
import { aliasForEntity } from '../shared/aliases.mjs'
import { customProfileAvatar } from '../shared/hashAvatar.mjs'
import { resolveDisplayName } from '../shared/nameResolve.mjs'
import { sendGroupMessage } from '../src/api/groupChannel.mjs'
import { syncTrustedAuthorsFromShell } from '../src/trustedAuthors.mjs'

import { applyProfileAvatarToHost } from './core/avatarCover.mjs'
import { wireHubBannerBindings } from './core/bindings.mjs'
import { hubStore } from './core/state.mjs'
import { wireHubGroupEmojiStickerGestures } from './emojiPickerGestures.mjs'
import { cancelScheduledChannelRefresh } from './messages/channelRefreshScheduler.mjs'
import { setupMisc } from './misc.mjs'
import { fetchUserProfile } from './presence.mjs'
import {
	refreshStopGenerationButton,
	resetVolatileStreamState,
} from './stream/index.mjs'

/** @returns {Promise<typeof import('./messages/messages.mjs')>} 按需加载的重型 messages 模块图 */
const messagesApi = () => import('./messages/messages.mjs')

/**
 * 用当前群 context 刷新顶栏展示名与头像（persona → 用户名 → 默认图）。
 * @returns {Promise<void>}
 */
export async function refreshViewerHubPresentation() {
	const entityHash = hubStore.viewer.viewerEntityHash
	if (!entityHash) return
	const profile = await fetchUserProfile(entityHash, {
		groupId: hubStore.context.currentGroupId || undefined,
		bypassCache: true,
	})
	const label = resolveDisplayName({
		entityHash,
		alias: aliasForEntity(entityHash),
		profileName: profile?.name,
	})
	hubStore.viewer.viewerDisplayName = label
	const myAvatar = document.getElementById('hub-my-avatar')
	const myName = document.getElementById('hub-my-name')
	myName.textContent = label
	await applyProfileAvatarToHost(myAvatar, {
		seed: entityHash,
		label,
		avatar: customProfileAvatar(profile),
		emojiFontSize: '18px',
	})
}

/** @returns {Promise<void>} 顶栏展示与在线状态（viewer 身份由 initCore 写入 hubStore） */
async function loadMe() {
	if (!hubStore.viewer.viewerEntityHash) return
	await refreshViewerHubPresentation()
	const { syncViewerPresence, startIdleWatcher } = await import('./hubStatus.mjs')
	await syncViewerPresence(hubStore.viewer.viewerEntityHash)
	startIdleWatcher()
}

/** @returns {string|null} 当前 operator entityHash */
function emojiViewerEntityHash() {
	return hubStore.viewer.viewerEntityHash
}

/** @returns {{ groupId: string|null, channelId: string|null, privateGroupId: string|null }} 当前群/私聊上下文 */
function emojiGetContext() {
	const privateGroupId = hubStore.privateGroup.groupId
	const groupId = hubStore.context.currentGroupId || privateGroupId
	const channelId = hubStore.context.currentChannelId || hubStore.privateGroup.channelId
	return { groupId, channelId, privateGroupId }
}

/**
 * @returns {typeof hubStore.sidebar.groups} 已加入群列表
 */
function hubPickerGetGroups() {
	return hubStore.sidebar.groups
}

/**
 * 构建表情选择器上下文（每次打开 picker 时刷新当前群）。
 * @returns {{ groupId: string|null, getGroups: typeof hubPickerGetGroups }} 提供商上下文
 */
function hubEmojiPickerContext() {
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
		const { loadMessages } = await messagesApi()
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
			const viewerEntityHash = emojiViewerEntityHash()
			if (viewerEntityHash)
				void fetch(`/api/parts/shells:chat/stickers/recent/${encodeURIComponent(stickerId)}`, {
					method: 'POST',
					credentials: 'include',
				})
			const { loadMessages } = await messagesApi()
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
 * 注册流式生成、消息编辑删除与私聊等重型 Hub 特性（延后加载 messages 模块图）。
 * @returns {Promise<void>}
 */
async function wireHubHeavyFeatures() {
	const { bindChannelMessageActions } = await import('./messages/actions/handlers.mjs')
	const { bindMessageDragExport } = await import('./messages/messageDragExport.mjs')

	// 触达 messages 模块图，确保频道消息管道已就绪
	await messagesApi()

	document.getElementById('hub-stop-generation-button')?.addEventListener('click', () => {
		resetVolatileStreamState({ abortBackend: true })
	})
	refreshStopGenerationButton()

	const messagesRoot = document.getElementById('hub-messages')
	bindChannelMessageActions(messagesRoot)
	bindMessageDragExport(messagesRoot)
	await wireHubPickers()
	void syncTrustedAuthorsFromShell()
	cancelScheduledChannelRefresh()
}

/**
 * 挂载 Hub 停靠式表情/贴纸选择器（共享 picker + Chat provider）。
 * @returns {Promise<void>}
 */
async function wireHubPickers() {
	const emojiPickerElement = document.getElementById('hub-emoji-picker')
	const emojiTabsElement = document.getElementById('hub-emoji-tabs')
	const emojiGridElement = document.getElementById('hub-emoji-grid')
	const emojiButton = document.getElementById('hub-emoji-button')
	const stickerPickerElement = document.getElementById('hub-sticker-picker')
	const stickerGridElement = document.getElementById('hub-sticker-grid')
	const stickerButton = document.getElementById('hub-sticker-button')
	const messageInput = document.getElementById('hub-message-input')

	if (emojiPickerElement && emojiTabsElement && emojiGridElement && emojiButton) {
		await mountDockedEmojiPicker({
			pickerElement: emojiPickerElement,
			tabsElement: emojiTabsElement,
			gridElement: emojiGridElement,
			triggerButton: emojiButton,
			inputElement: messageInput instanceof HTMLTextAreaElement ? messageInput : undefined,
			closeWhenOpening: stickerPickerElement,
			getPickerContext: hubEmojiPickerContext,
		})
		wireHubGroupEmojiStickerGestures(emojiGridElement, emojiPickerElement, sendPickedEmojiAsSticker)
	}

	if (stickerPickerElement && stickerGridElement && stickerButton)
		await mountDockedStickerPicker({
			pickerElement: stickerPickerElement,
			gridElement: stickerGridElement,
			triggerButton: stickerButton,
			closeWhenOpening: emojiPickerElement,
			context: {},
			onSelect: sendPickedHubSticker,
		})
}

/** @returns {Promise<void>} Hub 页面入口初始化（重型特性；导航由 initCore 完成） */
export async function init() {
	setupMisc()
	void import('./inboxClient.mjs').then(({ updateInboxBadge }) => updateInboxBadge())
	wireHubBannerBindings()
	void loadMe()
	await wireHubHeavyFeatures()
}
