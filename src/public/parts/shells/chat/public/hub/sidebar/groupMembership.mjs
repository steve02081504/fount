/**
 * 【文件】public/hub/sidebar/groupMembership.mjs
 * 【职责】选群时的入群判定、自动 join、联邦 catch-up。
 */
import { getGroupState, joinGroup } from '../../src/api/groupCore.mjs'
import { federationCatchUp } from '../../src/api/groupFederation.mjs'
import { broadcastHubGroupJoined } from '../../src/hubBroadcast.mjs'
import { resolvePowForJoin } from '../../src/powJoin.mjs'
import { handleUIError } from '../../src/ui/errors.mjs'
import {
	setPinsBookmarksWrapVisible,
	setSyncBanner,
	updateStatusBanners,
} from '../banners.mjs'
import { warmCharEntityHashCache } from '../core/domUtils.mjs'
import { hubStore, setHubState } from '../core/state.mjs'
import { consumePendingJoin, inviteCodeFromUrl, updateHash } from '../core/urlHash.mjs'
import { loadGroups } from '../serverBar.mjs'

import { renderChannelList } from './channels.mjs'
import { rebindFederationRoomQuiet } from './federationRoom.mjs'
import { renderGroupInfoCard } from './infoCard.mjs'
import { renderMemberList } from './members.mjs'

/**
 * 从联邦网络拉取群组事件并刷新当前频道消息。
 * @param {string} groupId 群组 ID
 * @param {{ waitMs?: number }} [options] catch-up 等待毫秒数
 * @returns {Promise<void>}
 */
export async function syncGroupFromNetwork(groupId, options = {}) {
	setSyncBanner(true)
	/** @type {{ federationActive?: boolean, wantIds: number, eventsFilled: number, wantIdsStillMissing: number, wantIdsRateLimited: boolean, tipsCollected?: number }} */
	let catchup
	try {
		catchup = await federationCatchUp(groupId, { waitMs: options.waitMs ?? 1400 })
	}
	catch (error) {
		const catchupError = handleUIError(error, 'chat.hub.syncFailed').message
		setSyncBanner(true, { i18nKey: 'chat.hub.syncFailed', params: { error: catchupError } })
		return
	}

	if (hubStore.context.currentGroupId === groupId && hubStore.context.currentChannelId) {
		setHubState('context.currentState', await getGroupState(groupId))
		const { loadMessages } = await import('../messages/messages.mjs')
		await loadMessages()
	}

	if (!catchup.federationActive) {
		setSyncBanner(false)
		return
	}
	const stillMissing = Number(catchup.wantIdsStillMissing) || 0
	const tipsCollected = Number(catchup.tipsCollected) || 0
	if (catchup.wantIdsRateLimited)
		setSyncBanner(true, { i18nKey: 'chat.hub.syncRateLimited' })
	else if (stillMissing > 0)
		setSyncBanner(true, {
			i18nKey: 'chat.hub.syncIncomplete',
			params: { missing: stillMissing, total: catchup.wantIds },
		})
	else if (tipsCollected === 0 && !catchup.wantIds && !catchup.eventsFilled)
		setSyncBanner(true, { i18nKey: 'chat.hub.syncNoPeers' })
	else
		setSyncBanner(false)
}

/**
 * @param {object} state 群状态
 * @param {{ inviteCode?: string | null, fedBootstrap?: object | null }} pendingJoin session 待消费邀请
 * @param {string | null} inviteCode URL 或 pending 邀请码
 * @returns {boolean} 是否应自动尝试入群
 */
function canAutoJoinGroup(state, pendingJoin, inviteCode) {
	if (state.isMember) return false
	if (state.hasLocalReplica) return true
	if (inviteCode) return true
	if (pendingJoin.fedBootstrap) return true
	return false
}

/**
 * 渲染无法入群时的 Hub 主区空态。
 * @returns {Promise<void>}
 */
async function showGroupJoinRequiredState() {
	const { disableComposer } = await import('../messages/composerController.mjs')
	const { mountTemplate } = await import('../../../../../scripts/features/template.mjs')
	setHubState('context.currentChannelId', null)
	updateHash(hubStore.context.currentGroupId, null)
	disableComposer()
	await mountTemplate(document.getElementById('hub-messages'), 'hub/empty/error', {
		i18nKey: 'chat.hub.groupJoinRequired',
		errorMessage: '',
	})
	setPinsBookmarksWrapVisible(false)
	updateStatusBanners()
}

/**
 * 入群或返回需手动入群的空态。
 * @param {string} groupId 群 ID
 * @param {object} state 群状态
 * @returns {Promise<object | null>} 入群后的 state；需手动入群时 null
 */
export async function ensureGroupMembership(groupId, state) {
	if (state.isMember) return state
	const pendingJoin = consumePendingJoin(groupId)
	const inviteCode = pendingJoin.inviteCode || inviteCodeFromUrl()
	if (!canAutoJoinGroup(state, pendingJoin, inviteCode)) {
		setHubState('context.currentState', state)
		hubStore.context.currentMode = 'groups'
		document.body.dataset.hubSurface = 'groups'
		document.querySelectorAll('.hub-server-item[data-mode]').forEach(el => {
			el.classList.toggle('mode-active', el.dataset.mode === 'groups')
		})
		const groupNameElement = document.getElementById('hub-group-name-display')
		groupNameElement.textContent = ''
		groupNameElement.dataset.i18n = 'chat.hub.groupTag'
		await renderChannelList(state)
		await renderMemberList(state)
		await renderGroupInfoCard(state)
		await showGroupJoinRequiredState()
		return null
	}
	const pow = await resolvePowForJoin(groupId, state, hubStore.viewer.nodeHash || '')
	await joinGroup(groupId, inviteCode, null, pow, pendingJoin.fedBootstrap)
	const joined = await getGroupState(groupId)
	broadcastHubGroupJoined(groupId)
	await loadGroups()
	return joined
}

/**
 * 同步群状态并刷新 viewer 展示。
 * @param {string} groupId 群 ID
 * @param {object} state 当前 state
 * @param {string | null} presetChannelId 预设频道
 * @returns {Promise<object>} 同步后的 state
 */
export async function syncGroupStateForHub(groupId, state, presetChannelId) {
	setHubState('context.currentState', state)
	rebindFederationRoomQuiet(groupId, {
		channelId: presetChannelId || state.groupSettings?.defaultChannelId || null,
	})
	void warmCharEntityHashCache()
	if (state.viewerEntityHash)
		hubStore.viewer.viewerEntityHash = state.viewerEntityHash
	const { refreshViewerHubPresentation } = await import('../init.mjs')
	await refreshViewerHubPresentation()
	if (state.viewerEntityHash) {
		const { syncViewerPresence } = await import('../hubStatus.mjs')
		await syncViewerPresence(state.viewerEntityHash)
	}
	const needsHeavySync = !Object.keys(state.channels || {}).length
	if (needsHeavySync)
		await syncGroupFromNetwork(groupId, { waitMs: 8000 })
	else if (state.federationActive)
		void syncGroupFromNetwork(groupId)
	else
		setSyncBanner(false)
	if (needsHeavySync) {
		state = await getGroupState(groupId)
		setHubState('context.currentState', state)
	}
	return state
}
