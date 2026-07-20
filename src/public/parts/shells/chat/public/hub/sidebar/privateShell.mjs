/**
 * 【文件】public/hub/sidebar/privateShell.mjs
 * 【职责】私聊侧栏壳：判定活跃私聊、返回好友列表、频道列表挂载容器。
 */
import { mountTemplate } from '../../../../../scripts/features/template.mjs'
import { updateStatusBanners } from '../banners.mjs'
import { store, setState } from '../core/state.mjs'
import { updateFriendsHash } from '../core/urlHash.mjs'
import { cancelScheduledChannelRefresh } from '../messages/channelRefreshScheduler.mjs'
import { clearPrivateGroupState } from '../privateGroup.mjs'
import { closeGroupWebSocket } from '../stream/index.mjs'

/**
 * @returns {boolean} 好友模式下是否处于活跃私聊会话
 */
export function isPrivateChatActive() {
	return store.context.currentMode === 'friends' && !!store.privateGroup.groupId
}

/**
 * @returns {HTMLElement | null} 频道列表挂载容器
 */
export function getChannelListContainer() {
	if (isPrivateChatActive()) {
		const host = document.getElementById('private-channel-list-host')
		if (host) return host
	}
	return document.getElementById('channel-list')
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
	setState('context.currentGroupId', null)
	setState('context.currentChannelId', null)
	setState('context.currentState', null)
	updateFriendsHash()
	disableComposer()
	await mountTemplate(document.getElementById('messages'), 'hub/empty/idle', {
		iconHtml: '<img src="https://api.iconify.design/mdi/account-group-outline.svg" class="empty-icon-img" width="48" height="48" alt="" aria-hidden="true" />',
	})
	document.getElementById('channel-name-display').dataset.i18n = 'chat.hub.friendsHeader'
	document.getElementById('info-card-host').innerHTML = ''
	await renderFriendsColumn(await loadFriendsList())
	refreshHubHeaderButtons()
	updateStatusBanners()
}
