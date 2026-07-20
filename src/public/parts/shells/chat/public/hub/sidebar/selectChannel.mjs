/**
 * 【文件】public/hub/sidebar/selectChannel.mjs
 * 【职责】切换频道：composer、草稿、消息加载、群 WS。
 */
import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { updateChannelListItems } from '../../src/api/groupChannel.mjs'
import { getGroupState } from '../../src/api/groupCore.mjs'
import { createFileHandlers } from '../../src/ui/groupFileUpload.mjs'
import { updateStatusBanners } from '../banners.mjs'
import { channelTypeIconHtml } from '../channels.mjs'
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
	const channel = store.context.currentState?.channels?.[channelId]
	if (!channel) {
		setState('context.currentChannelId', null)
		updateHash(store.context.currentGroupId, null)
		disableComposer()
		const { renderHubChannelSidebar } = await import('./index.mjs')
		await renderHubChannelSidebar(store.context.currentState)
		const { mountTemplate } = await import('../../../../../scripts/features/template.mjs')
		await mountTemplate(document.getElementById('messages'), 'hub/nav/side_muted', {
			i18nKey: 'chat.hub.noChannels',
		})
		updateStatusBanners()
		return
	}
	setState('context.currentChannelId', channelId)
	if (isPrivateChatActive())
		store.privateGroup.channelId = channelId
	updateHash(store.context.currentGroupId, channelId)
	void import('../composerReply.mjs').then(({ clearReplyTarget }) => clearReplyTarget())
	const { showHubMainPane } = await import('../hubPane.mjs')
	showHubMainPane()
	void warmCharEntityHashCache()
	const { renderHubChannelSidebar } = await import('./index.mjs')
	await renderHubChannelSidebar(store.context.currentState)
	if (store.context.currentGroupId)
		rebindFederationRoomQuiet(store.context.currentGroupId, { channelId })
	const channelType = channel.type || 'text'
	document.getElementById('channel-name-display').textContent = channel.name || channelId
	const headerIcon = document.querySelector('.main-header-icon')
	headerIcon.innerHTML = await channelTypeIconHtml(channelType)

	if (channelType === 'list' || channelType === 'streaming')
		disableComposer(channelType === 'list' ? 'chat.hub.channelReadonlyList' : 'chat.hub.channelReadonlyStream')
	else if (store.context.currentState?.suspectedRemoved)
		disableComposer('chat.hub.composerSuspectedRemoved')
	else
		enableComposer()
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
	void import('../composerDraft.mjs').then(({ loadDraft }) => {
		loadDraft(store.context.currentGroupId, channelId)
	})
	await loadMessages()
	if (store.context.currentGroupId && store.context.currentChannelId && channelType === 'text')
		connectGroupWebSocket(store.context.currentGroupId, store.context.currentChannelId)
	updateStatusBanners()
	void refreshPinsBookmarks()
	void import('../call.mjs').then(m => {
		m.refreshCallButtonActiveForCurrentChannel()
		void m.refreshCallStatusBadge()
	})
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
