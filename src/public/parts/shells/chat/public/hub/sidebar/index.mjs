/**
 * 【文件】public/hub/sidebar/index.mjs
 * 【职责】群侧栏协调入口：组装频道树 / 成员 / 信息卡，驱动 selectGroup / selectChannel。
 */
import { mountTemplate } from '../../../../../scripts/features/template.mjs'
import { getGroupState } from '../../src/api/groupCore.mjs'
import { handleUIError } from '../../src/ui/errors.mjs'
import {
	setPinsBookmarksWrapVisible,
	updateStatusBanners,
} from '../banners.mjs'
import { groupDisplayName } from '../core/domUtils.mjs'
import { hubStore, setHubState } from '../core/state.mjs'
import { parseHash, updateHash } from '../core/urlHash.mjs'
import { resetFilesDrawerWire } from '../files.mjs'
import { cancelScheduledChannelRefresh } from '../messages/channelRefreshScheduler.mjs'
import { clearPinPreviewCache } from '../messages/pinPreview.mjs'
import { refreshPinsBookmarks } from '../pinsBookmarks.mjs'
import { clearPrivateGroupState } from '../privateGroup.mjs'
import { loadGroups } from '../serverBar.mjs'
import { closeGroupWebSocket } from '../stream/index.mjs'

import { renderChannelList } from './channels.mjs'
import { ensureGroupMembership, syncGroupStateForHub } from './groupMembership.mjs'
import { renderGroupInfoCard } from './infoCard.mjs'
import { renderMemberList } from './members.mjs'
import { backToFriendsList, isPrivateChatActive } from './privateShell.mjs'
import { selectChannel } from './selectChannel.mjs'

/**
 *
 */
export { renderChannelList } from './channels.mjs'
/**
 *
 */
export { renderGroupInfoCard } from './infoCard.mjs'
/**
 *
 */
export { renderMemberList } from './members.mjs'
/**
 *
 */
export { backToFriendsList, isPrivateChatActive } from './privateShell.mjs'
/**
 *
 */
export { saveListChannelItems, selectChannel } from './selectChannel.mjs'

/**
 * 渲染 Hub 侧栏频道区（私聊壳 + 频道树）。
 * @param {object} state 群组状态
 * @returns {Promise<void>}
 */
export async function renderHubChannelSidebar(state) {
	if (isPrivateChatActive()) {
		const root = document.getElementById('hub-channel-list')
		await mountTemplate(root, 'hub/nav/private_chat_sidebar_shell', {})
		root.querySelector('#hub-private-chat-back')?.addEventListener('click', () => {
			void backToFriendsList()
		})
	}
	await renderChannelList(state)
}

/**
 * 渲染群侧栏与标题。
 * @param {object} state 群 state
 * @returns {Promise<void>}
 */
async function paintGroupHubChrome(state) {
	const groupNameElement = document.getElementById('hub-group-name-display')
	delete groupNameElement.dataset.i18n
	groupNameElement.textContent = await groupDisplayName(hubStore.context.currentGroupId, state.groupMeta.name)
	await renderChannelList(state)
	await renderMemberList(state)
	hubStore.context.currentMode = 'groups'
	document.querySelectorAll('.hub-server-item[data-mode]').forEach(el => {
		el.classList.toggle('mode-active', el.dataset.mode === 'groups')
	})
	await renderGroupInfoCard(state)
	void import('../messages/composerController.mjs').then(({ refreshHubHeaderButtons }) => refreshHubHeaderButtons())
	updateStatusBanners()
}

/**
 * 进入默认或预设频道。
 * @param {object} state 群 state
 * @param {string | null} presetChannelId 预设频道
 * @returns {Promise<void>}
 */
async function activateGroupChannel(state, presetChannelId) {
	const channelIds = Object.keys(state.channels || {})
	const targetChannelId = presetChannelId && state.channels?.[presetChannelId]
		? presetChannelId
		: state.groupSettings?.defaultChannelId || channelIds[0] || null
	if (targetChannelId) await selectChannel(targetChannelId)
	else {
		setHubState('context.currentChannelId', null)
		updateHash(hubStore.context.currentGroupId, null)
		const { disableComposer } = await import('../messages/composerController.mjs')
		disableComposer('chat.hub.noChannel')
		updateStatusBanners()
		void refreshPinsBookmarks()
	}
}

/**
 * 同群 hash 已指向另一频道时采纳 hash（selectGroup 长 await 期间用户/深链可能已改地址栏）。
 * @param {string} groupId 当前群
 * @param {string | null} fallback 预设频道
 * @returns {string | null} 应激活的频道
 */
function channelIdFromHashOr(groupId, fallback) {
	const { groupId: hashGroupId, channelId } = parseHash()
	return hashGroupId === groupId && channelId ? channelId : fallback
}

/**
 * 选中群组：入群、同步、渲染频道/成员并进入默认频道。
 * @param {string} groupId 群组 ID
 * @param {string | null} [presetChannelId] URL 或深链指定的频道
 * @returns {Promise<void>}
 */
export async function selectGroup(groupId, presetChannelId = null) {
	if (!groupId) return
	const channelId = channelIdFromHashOr(groupId, presetChannelId)
	clearPinPreviewCache()
	clearPrivateGroupState()
	resetFilesDrawerWire()
	closeGroupWebSocket()
	cancelScheduledChannelRefresh()
	setHubState('context.currentGroupId', groupId)
	setHubState('context.currentState', null)
	updateHash(groupId, channelId)
	const { setMode } = await import('../mode.mjs')
	await setMode('groups')
	await loadGroups()
	try {
		let state = await getGroupState(groupId)
		const memberState = await ensureGroupMembership(groupId, state)
		if (!memberState) return
		state = memberState
		state = await syncGroupStateForHub(groupId, state, channelId)
		await paintGroupHubChrome(state)
		await activateGroupChannel(state, channelIdFromHashOr(groupId, channelId))
	}
	catch (error) {
		setPinsBookmarksWrapVisible(false)
		updateStatusBanners()
		const err = handleUIError(error, 'chat.hub.loadGroupFailed')
		await mountTemplate(document.getElementById('hub-messages'), 'hub/empty/error', {
			i18nKey: 'chat.hub.loadGroupFailed',
			errorMessage: err.message,
		})
	}
}

/**
 * 导航至群组设置页（整页，非 Hub 内 modal）。
 * @param {string} groupId 群组 ID
 * @returns {void}
 */
export function navigateToGroupSettings(groupId) {
	window.location.href = `/parts/shells:chat/settings/#settings:${encodeURIComponent(groupId)}`
}
