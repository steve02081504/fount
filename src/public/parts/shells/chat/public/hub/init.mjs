/**
 * 【文件】public/hub/init.mjs
 * 【职责】Hub 主入口 bootstrap：i18n/模板/可信作者/deep link、挂载消息与导航、顶栏 persona 展示。
 * 【原理】bindChannelMessageActions；导航由 initCore 完成。刷新顶栏与停止生成按钮直接调用模块导出。
 * 【数据结构】store（core/state）持有 currentGroupId、viewerEntityHash、频道上下文。
 * 【关联】hub 页面加载时调用；串联 messages、stream、hashNav、chat、presence、wireEvents。
 */
import { mountDockedEmojiPicker } from '../../../../scripts/components/emojiPicker.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { aliasForEntity } from '../shared/aliases.mjs'
import { normalizeChannelMessage } from '../shared/channelContent.mjs'
import { displayProfileAvatar } from '../shared/hashAvatar.mjs'
import { resolveDisplayName } from '../shared/nameResolve.mjs'
import { sendGroupMessage } from '../src/api/groupChannel.mjs'
import { syncTrustedAuthorsFromShell } from '../src/trustedAuthors.mjs'

import { applyProfileAvatarToHost } from './core/avatarCover.mjs'
import { wireHubBannerBindings } from './core/bindings.mjs'
import { store } from './core/state.mjs'
import { wireHubGroupEmojiStickerGestures } from './gestures/emojiPickerGestures.mjs'
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
	const entityHash = store.viewer.viewerEntityHash
	if (!entityHash) return
	const profile = await fetchUserProfile(entityHash, {
		groupId: store.context.currentGroupId || undefined,
		bypassCache: true,
	})
	const label = resolveDisplayName({
		entityHash,
		alias: aliasForEntity(entityHash),
		profileName: profile?.name,
	})
	store.viewer.viewerDisplayName = label
	const myAvatar = document.getElementById('my-avatar')
	const myName = document.getElementById('my-name')
	myName.textContent = label
	await applyProfileAvatarToHost(myAvatar, {
		seed: entityHash,
		label,
		avatar: displayProfileAvatar(profile),
		emojiFontSize: '18px',
	})
}

/** @returns {Promise<void>} 顶栏展示与在线状态（viewer 身份由 initCore 写入 store） */
async function loadMe() {
	if (!store.viewer.viewerEntityHash) return
	await refreshViewerHubPresentation()
	const { syncViewerPresence, startIdleWatcher } = await import('./hubStatus.mjs')
	await syncViewerPresence(store.viewer.viewerEntityHash)
	startIdleWatcher()
}

/** @returns {{ groupId: string|null, channelId: string|null, privateGroupId: string|null }} 当前群/私聊上下文 */
function emojiGetContext() {
	const privateGroupId = store.privateGroup.groupId
	const groupId = store.context.currentGroupId || privateGroupId
	const channelId = store.context.currentChannelId || store.privateGroup.channelId
	return { groupId, channelId, privateGroupId }
}

/**
 * @returns {typeof store.sidebar.groups} 已加入群列表
 */
function hubPickerGetGroups() {
	return store.sidebar.groups
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
 * 表情长按/右键：作为贴纸消息发送。
 * @param {{ emojiRef?: string, emojiId?: string }} item - 选中的表情。
 * @returns {Promise<void>}
 */
async function sendPickedEmojiAsSticker(item) {
	const { groupId, channelId } = emojiGetContext()
	if (!groupId || !channelId) return
	try {
		await sendGroupMessage(groupId, channelId, normalizeChannelMessage({
			type: 'sticker',
			emojiRef: item.emojiRef,
			stickerName: item.emojiId || 'emoji',
		}))
		const { loadMessages } = await messagesApi()
		await loadMessages()
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

	document.getElementById('stop-generation-button')?.addEventListener('click', () => {
		resetVolatileStreamState({ abortBackend: true })
	})
	refreshStopGenerationButton()

	const messagesRoot = document.getElementById('messages')
	bindChannelMessageActions(messagesRoot)
	bindMessageDragExport(messagesRoot)
	await wireHubPickers()
	void syncTrustedAuthorsFromShell()
	cancelScheduledChannelRefresh()
}

/**
 * 挂载 Hub 停靠式表情选择器（点击插 token；长按/右键发贴纸）。
 * @returns {Promise<void>}
 */
async function wireHubPickers() {
	const emojiPickerElement = document.getElementById('emoji-picker')
	const emojiButton = document.getElementById('emoji-button')
	const messageInput = document.getElementById('message-input')

	if (emojiPickerElement && emojiButton) {
		await mountDockedEmojiPicker({
			pickerElement: emojiPickerElement,
			triggerButton: emojiButton,
			inputElement: messageInput instanceof HTMLTextAreaElement ? messageInput : undefined,
			getPickerContext: hubEmojiPickerContext,
		})
		wireHubGroupEmojiStickerGestures(emojiPickerElement, emojiPickerElement, sendPickedEmojiAsSticker)
	}
}

/** @returns {Promise<void>} Hub 页面入口初始化（重型特性；导航由 initCore 完成） */
export async function init() {
	setupMisc()
	void import('./inboxClient.mjs').then(({ updateInboxBadge }) => updateInboxBadge())
	wireHubBannerBindings()
	void loadMe()
	await wireHubHeavyFeatures()
}
