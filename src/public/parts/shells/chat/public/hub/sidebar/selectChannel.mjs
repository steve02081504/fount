/**
 * 【文件】public/hub/sidebar/selectChannel.mjs
 * 【职责】切换频道：composer、草稿、消息加载、群 WS。
 */
import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { updateChannelListItems } from '../../src/endpoints/groupChannel.mjs'
import { getGroupState } from '../../src/endpoints/groupCore.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { createFileHandlers } from '../../src/ui/groupFileUpload.mjs'
import { updateStatusBanners } from '../banners.mjs'
import {
	refreshCallButtonActiveForCurrentChannel,
	refreshCallStatusBadge,
} from '../call.mjs'
import { channelTypeIconHtml } from '../channels.mjs'
import { loadDraft } from '../composerDraft.mjs'
import { clearReplyTarget } from '../composerReply.mjs'
import { warmCharEntityHashCache } from '../core/domUtils.mjs'
import { store, setState } from '../core/state.mjs'
import { updateHash } from '../core/urlHash.mjs'
import { refreshPinsBookmarks } from '../pinsBookmarks.mjs'
import { connectGroupWebSocket } from '../stream/index.mjs'

import { rebindFederationRoomQuiet } from './federationRoom.mjs'
import { isPrivateChatActive } from './privateShell.mjs'

/**
 * 切换当前频道并加载消息、连接 WebSocket。
 * @param {string} channelId 频道 ID
 * @returns {Promise<void>}
 */
export async function selectChannel(channelId) {
	const { disableComposer, enableComposer } = await import('../messages/composerController.mjs')
	const prevGroupId = store.context.currentGroupId
	const prevChannelId = store.context.currentChannelId
	if (prevGroupId && prevChannelId && prevChannelId !== channelId) {
		const { selectedFiles } = await import('../composerFiles.mjs')
		const { stashDraftFiles, flushDraft } = await import('../composerDraft.mjs')
		stashDraftFiles(prevGroupId, prevChannelId, selectedFiles)
		const input = document.getElementById('message-input')
		const contentWarningInput = document.getElementById('content-warning')
		const sensitiveMediaInput = document.getElementById('sensitive-media')
		flushDraft(prevGroupId, prevChannelId, {
			text: input instanceof HTMLTextAreaElement ? input.value : '',
			content_warning: contentWarningInput instanceof HTMLInputElement ? contentWarningInput.value.trim() : '',
			sensitive_media: sensitiveMediaInput instanceof HTMLInputElement ? sensitiveMediaInput.checked : false,
		})
	}
	const channel = store.context.currentState?.channels?.[channelId]
	if (!channel) {
		setState('context.currentChannelId', null)
		updateHash(store.context.currentGroupId, null)
		disableComposer()
		const { renderHubChannelSidebar } = await import('./index.mjs')
		await renderHubChannelSidebar(store.context.currentState)
		const { mountTemplate } = await import('../../../../../scripts/features/template.mjs')
		await mountTemplate(document.getElementById('messages'), 'hub/nav/side_muted', {
			i18nKey: 'chat.hub.no.channels',
		})
		updateStatusBanners()
		return
	}
	setState('context.currentChannelId', channelId)
	if (isPrivateChatActive())
		store.privateGroup.channelId = channelId
	updateHash(store.context.currentGroupId, channelId)
	clearReplyTarget()
	const channelType = channel.type || 'text'
	// surface/composer 必须在 showHubMainPane 之前落好：mobile 主屏一开，groups surface 会把 .input-area display:none
	if (channelType === 'list' || channelType === 'streaming')
		disableComposer(channelType === 'list' ? 'chat.hub.channel.readonlyList' : 'chat.hub.channel.readonlyStream')
	else if (store.context.currentState?.suspectedRemoved)
		disableComposer('chat.hub.composerSuspectedRemoved')
	else
		enableComposer()
	const { showHubMainPane } = await import('../hubPane.mjs')
	showHubMainPane()
	warmCharEntityHashCache().catch(handleError('chat.hub.warmCharCacheFailed'))
	const titleEl = document.getElementById('channel-name-display')
	delete titleEl.dataset.i18n
	titleEl.textContent = channel.name || channelId
	titleEl.setAttribute('user-content', '')
	const headerIcon = document.querySelector('.main-header-icon')
	const { renderHubChannelSidebar } = await import('./index.mjs')
	await Promise.all([
		renderHubChannelSidebar(store.context.currentState),
		channelTypeIconHtml(channelType).then(html => { headerIcon.innerHTML = html }),
	])
	if (store.context.currentGroupId)
		rebindFederationRoomQuiet(store.context.currentGroupId, { channelId })
	const { loadMessages } = await import('../messages/messages.mjs')
	store.context.fileHandlers = createFileHandlers({
		groupId: store.context.currentGroupId,
		showToastI18n,
		/** @returns {Promise<void>} */
		loadMessages: () => loadMessages(),
		/** @returns {string | null} 当前频道 ID（文件上传权限） */
		getUploadChannelId: () => store.context.currentChannelId,
		/** @returns {object | null} 当前群 state（读取文件加密模式） */
		getCurrentState: () => store.context.currentState,
	})
	await loadDraft(store.context.currentGroupId, channelId)
	await loadMessages()
	if (store.context.currentGroupId && store.context.currentChannelId && channelType === 'text')
		connectGroupWebSocket(store.context.currentGroupId, store.context.currentChannelId)
	updateStatusBanners()
	refreshPinsBookmarks().catch(handleError('chat.hub.operationFailed'))
	refreshCallButtonActiveForCurrentChannel()
	refreshCallStatusBadge().catch(handleError('chat.hub.operationFailed'))
}

/**
 * 保存 list 类型频道条目。
 * @param {object[]} items 列表频道条目
 * @returns {Promise<void>}
 */
export async function saveListChannelItems(items) {
	await updateChannelListItems(store.context.currentGroupId, store.context.currentChannelId, items)
	setState('context.currentState', await getGroupState(store.context.currentGroupId))
}
