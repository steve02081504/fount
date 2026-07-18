/**
 * 【文件】public/hub/sidebar/privateShell.mjs
 * 【职责】私聊侧栏壳：判定活跃私聊、返回好友列表、频道列表挂载容器。
 */
import { mountTemplate } from '../../../../../scripts/features/template.mjs'
import { updateStatusBanners } from '../banners.mjs'
import { hubStore, setHubState } from '../core/state.mjs'
import { updateFriendsHash } from '../core/urlHash.mjs'
import { cancelScheduledChannelRefresh } from '../messages/channelRefreshScheduler.mjs'
import { clearPrivateGroupState } from '../privateGroup.mjs'
import { closeGroupWebSocket } from '../stream/index.mjs'

/**
 * @returns {boolean} 好友模式下是否处于活跃私聊会话
 */
export function isPrivateChatActive() {
	return hubStore.context.currentMode === 'friends' && !!hubStore.privateGroup.groupId
}

/**
 * @returns {HTMLElement | null} 频道列表挂载容器
 */
export function getChannelListContainer() {
	if (isPrivateChatActive()) {
		const host = document.getElementById('hub-private-channel-list-host')
		if (host) return host
	}
	return document.getElementById('hub-channel-list')
}

/**
 * 从私聊返回好友列表 idle 视图。
 * @returns {Promise<void>}
 */
export async function backToFriendsList() {
	cancelScheduledChannelRefresh()
	const { disableComposer, refreshHubHeaderButtons } = await import('../messages/composerController.mjs')
	const { loadFriendsList, renderFriendsColumn } = await import('../friendsList.mjs')
	closeGroupWebSocket()
	clearPrivateGroupState()
	setHubState('context.currentGroupId', null)
	setHubState('context.currentChannelId', null)
	setHubState('context.currentState', null)
	updateFriendsHash()
	disableComposer()
	await mountTemplate(document.getElementById('hub-messages'), 'hub/empty/idle', {
		iconHtml: '<img src="https://api.iconify.design/mdi/account-group-outline.svg" class="hub-empty-icon-img" width="48" height="48" alt="" aria-hidden="true" />',
	})
	document.getElementById('hub-channel-name-display').dataset.i18n = 'chat.hub.friendsHeader'
	document.getElementById('hub-info-card-host').innerHTML = ''
	await renderFriendsColumn(await loadFriendsList())
	refreshHubHeaderButtons()
	updateStatusBanners()
}
