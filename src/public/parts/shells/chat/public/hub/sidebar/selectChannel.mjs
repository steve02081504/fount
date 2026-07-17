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
import { hubStore, setHubState } from '../core/state.mjs'
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
	const channel = hubStore.context.currentState?.channels?.[channelId]
	if (!channel) {
		setHubState('context.currentChannelId', null)
		updateHash(hubStore.context.currentGroupId, null)
		disableComposer('chat.hub.noChannel')
		const { renderHubChannelSidebar } = await import('./index.mjs')
		await renderHubChannelSidebar(hubStore.context.currentState)
		const { mountTemplate } = await import('../../../../../scripts/features/template.mjs')
		await mountTemplate(document.getElementById('hub-messages'), 'hub/nav/side_muted', {
			i18nKey: 'chat.hub.noChannels',
		})
		updateStatusBanners()
		return
	}
	setHubState('context.currentChannelId', channelId)
	if (isPrivateChatActive())
		hubStore.privateGroup.channelId = channelId
	updateHash(hubStore.context.currentGroupId, channelId)
	void warmCharEntityHashCache()
	const { renderHubChannelSidebar } = await import('./index.mjs')
	await renderHubChannelSidebar(hubStore.context.currentState)
	if (hubStore.context.currentGroupId)
		rebindFederationRoomQuiet(hubStore.context.currentGroupId, { channelId })
	const channelType = channel.type || 'text'
	document.getElementById('hub-channel-name-display').textContent = channel.name || channelId
	const headerIcon = document.querySelector('.hub-main-header-icon')
	headerIcon.innerHTML = await channelTypeIconHtml(channelType)

	if (channelType === 'list' || channelType === 'streaming')
		disableComposer(channelType === 'list' ? 'chat.hub.channelReadonlyList' : 'chat.hub.channelReadonlyStream')
	else if (hubStore.context.currentState?.suspectedRemoved)
		disableComposer('chat.hub.banners.suspectedRemovedComposer')
	else
		enableComposer()
	const { loadMessages } = await import('../messages/messages.mjs')
	hubStore.context.fileHandlers = createFileHandlers({
		groupId: hubStore.context.currentGroupId,
		showToastI18n,
		/** @returns {Promise<void>} */
		loadMessages: () => loadMessages(),
		/** @returns {string | null} 当前频道 ID（文件上传权限） */
		getUploadChannelId: () => hubStore.context.currentChannelId,
		/** @returns {object | null} 当前群 state（读取文件加密模式） */
		getCurrentState: () => hubStore.context.currentState,
	})
	void import('../composerDraft.mjs').then(({ loadDraft }) => {
		loadDraft(hubStore.context.currentGroupId, channelId)
	})
	await loadMessages()
	if (hubStore.context.currentGroupId && hubStore.context.currentChannelId && channelType === 'text')
		connectGroupWebSocket(hubStore.context.currentGroupId, hubStore.context.currentChannelId)
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
	await updateChannelListItems(hubStore.context.currentGroupId, hubStore.context.currentChannelId, items)
	setHubState('context.currentState', await getGroupState(hubStore.context.currentGroupId))
}
