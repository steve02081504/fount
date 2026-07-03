/**
 * 【文件】public/hub/mode.mjs
 * 【职责】Hub 左侧主模式切换：「群组」与「好友」两套布局的激活、数据加载与 composer 状态清理。
 * 【原理】`setActiveModeTab` 高亮模式按钮；`setMode('friends')` 渲染好友列并隐藏群相关侧栏元素；切到好友模式时 `disableComposer` 并取消频道增量定时器。
 * 【数据结构】hubStore（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】进入好友列表时 `updateFriendsHash` 写入 `#friends`；groupStream、friendsList、groupNav。
 */
import { mountTemplate } from '../../../../scripts/features/template.mjs'

import { setPinsBookmarksWrapVisible, updateStatusBanners } from './banners.mjs'
import { hubStore, setHubState } from './core/state.mjs'
import { updateFriendsHash } from './core/urlHash.mjs'
import { loadFriendsList, renderFriendsColumn } from './friendsList.mjs'
import {
	isPrivateChatActive,
	renderChannelList,
	renderGroupInfoCard,
	renderHubChannelSidebar,
	renderMemberList,
} from './groupNav.mjs'
import { closeGroupWebSocket } from './groupStream.mjs'
import { cancelScheduledChannelRefresh } from './messages/channelRefreshScheduler.mjs'
import {
	clearPrivateGroupState,
} from './privateGroup.mjs'

/**
 * 高亮左侧「群组 / 好友」模式切换按钮。
 * @param {'groups' | 'friends'} mode 主栏模式
 * @returns {void}
 */
export function setActiveModeTab(mode) {
	document.querySelectorAll('.hub-server-item[data-mode]').forEach((el) => {
		el.classList.toggle('mode-active', el.dataset.mode === mode)
	})
}

/**
 * 切换 Hub 主模式（群组 / 好友）。
 * @param {'groups' | 'friends'} mode 目标模式
 * @returns {Promise<void>}
 */
export async function setMode(mode) {
	hubStore.context.currentMode = mode
	setActiveModeTab(mode)
	const container = document.getElementById('hub-channel-list')
	await mountTemplate(container, 'hub/nav/side_muted', { i18nKey: 'chat.hub.loading' })
	document.getElementById('hub-member-list').innerHTML = ''
	document.getElementById('hub-info-card-host').innerHTML = ''

	if (mode === 'friends')
		setPinsBookmarksWrapVisible(false)

	const keepPrivateGroupSession = mode === 'friends'
		&& (hubStore.privateGroup.groupId || hubStore.friendChatEntering)
	if (!keepPrivateGroupSession) {
		cancelScheduledChannelRefresh()
		closeGroupWebSocket()
		clearPrivateGroupState()
	}

	if (mode === 'friends' && !keepPrivateGroupSession) {
		updateFriendsHash()
		setHubState('currentGroupId', null)
		setHubState('currentChannelId', null)
		setHubState('currentState', null)
		const { disableComposer } = await import('./messages/composerController.mjs')
		disableComposer('chat.hub.composerDisabled')
		await mountTemplate(document.getElementById('hub-messages'), 'hub/empty/idle', {
			iconHtml: '<img src="https://api.iconify.design/mdi/account-group-outline.svg" class="hub-empty-icon-img" width="48" height="48" alt="" aria-hidden="true" />',
		})
		document.getElementById('hub-channel-name-display').dataset.i18n = 'chat.hub.friendsHeader'
	}

	const { refreshHubHeaderButtons } = await import('./messages/composerController.mjs')
	refreshHubHeaderButtons()
	if (mode === 'friends')
		if (isPrivateChatActive() && hubStore.context.currentState)
			await renderHubChannelSidebar(hubStore.context.currentState)
		else
			await renderFriendsColumn(await loadFriendsList())

	else if (mode === 'groups')
		if (!hubStore.context.currentGroupId || !hubStore.context.currentState) {
			setPinsBookmarksWrapVisible(false)
			updateStatusBanners()
			container.innerHTML = ''
		}
		else {
			await renderChannelList(hubStore.context.currentState)
			await renderMemberList(hubStore.context.currentState)
			await renderGroupInfoCard(hubStore.context.currentState)
		}
}
