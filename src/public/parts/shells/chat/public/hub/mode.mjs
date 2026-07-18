/**
 * 【文件】public/hub/mode.mjs
 * 【职责】Hub 左侧主模式切换：「群组」「好友」「收件箱」「群发现」布局的激活、数据加载与 composer 状态清理。
 * 【原理】`setActiveModeTab` 高亮模式按钮；`setMode` 统一驱动 friends / groups / inbox。
 * 【数据结构】store（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】进入好友列表时 `updateFriendsHash` 写入 `#friends`；stream、friendsList、sidebar、inboxView。
 */
import { mountTemplate } from '../../../../scripts/features/template.mjs'

import { setPinsBookmarksWrapVisible, updateStatusBanners } from './banners.mjs'
import { store, setState } from './core/state.mjs'
import { updateFriendsHash } from './core/urlHash.mjs'
import { loadFriendsList, renderFriendsColumn } from './friendsList.mjs'
import { cancelScheduledChannelRefresh } from './messages/channelRefreshScheduler.mjs'
import {
	clearPrivateGroupState,
} from './privateGroup.mjs'
import {
	isPrivateChatActive,
	renderChannelList,
	renderGroupInfoCard,
	renderHubChannelSidebar,
	renderMemberList,
} from './sidebar/index.mjs'
import { closeGroupWebSocket } from './stream/index.mjs'

/**
 * 高亮左侧「群组 / 好友 / 收件箱」模式切换按钮。
 * @param {'groups' | 'friends' | 'inbox' | 'discovery'} mode 主栏模式
 * @returns {void}
 */
export function setActiveModeTab(mode) {
	document.querySelectorAll('.server-item[data-mode]').forEach((el) => {
		el.classList.toggle('mode-active', el.dataset.mode === mode)
	})
}

/**
 * 切换 Hub 主模式（群组 / 好友 / 收件箱）。
 * @param {'groups' | 'friends' | 'inbox' | 'discovery'} mode 目标模式
 * @returns {Promise<void>}
 */
export async function setMode(mode) {
	if (mode !== 'inbox') {
		const { closeInboxView } = await import('./inboxView.mjs')
		closeInboxView()
	}

	store.context.currentMode = mode
	document.body.dataset.surface = mode
	setActiveModeTab(mode)
	const { showHubNavPane } = await import('./hubPane.mjs')
	showHubNavPane()

	if (mode === 'inbox') {
		const { activateInboxView } = await import('./inboxView.mjs')
		await activateInboxView()
		return
	}
	if (mode === 'discovery') {
		const { activateDiscoveryView } = await import('./discoveryPanel.mjs')
		await activateDiscoveryView()
		return
	}

	const container = document.getElementById('channel-list')
	await mountTemplate(container, 'hub/nav/side_muted', { i18nKey: 'chat.hub.loading' })
	document.getElementById('member-list').innerHTML = ''
	document.getElementById('info-card-host').innerHTML = ''

	if (mode === 'friends')
		setPinsBookmarksWrapVisible(false)

	const keepPrivateGroupSession = mode === 'friends'
		&& (store.privateGroup.groupId || store.friendChatEntering)
	if (!keepPrivateGroupSession) {
		cancelScheduledChannelRefresh()
		closeGroupWebSocket()
		clearPrivateGroupState()
	}

	if (mode === 'friends' && !keepPrivateGroupSession) {
		updateFriendsHash()
		setState('context.currentGroupId', null)
		setState('context.currentChannelId', null)
		setState('context.currentState', null)
		const { disableComposer } = await import('./messages/composerController.mjs')
		disableComposer()
		await mountTemplate(document.getElementById('messages'), 'hub/empty/friends')
		document.getElementById('friends-empty-search-button')?.addEventListener('click', () => {
			document.getElementById('friends-search-input')?.focus()
		})
		document.getElementById('channel-name-display').dataset.i18n = 'chat.hub.friendsHeader'
	}

	const { refreshHubHeaderButtons } = await import('./messages/composerController.mjs')
	refreshHubHeaderButtons()
	if (mode === 'friends')
		if (isPrivateChatActive() && store.context.currentState)
			await renderHubChannelSidebar(store.context.currentState)
		else
			await renderFriendsColumn(await loadFriendsList())

	else if (mode === 'groups')
		if (!store.context.currentGroupId || !store.context.currentState) {
			setPinsBookmarksWrapVisible(false)
			updateStatusBanners()
			container.innerHTML = ''
		}
		else {
			await renderChannelList(store.context.currentState)
			await renderMemberList(store.context.currentState)
			await renderGroupInfoCard(store.context.currentState)
		}

}
