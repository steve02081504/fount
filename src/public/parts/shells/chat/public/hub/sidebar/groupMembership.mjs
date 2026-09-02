/**
 * 【文件】public/hub/sidebar/groupMembership.mjs
 * 【职责】选群时的入群判定、自动 join、联邦 catch-up。
 */
import { getGroupState, getPowChallenge, joinGroup } from '../../src/endpoints/groupCore.mjs'
import { federationCatchUp } from '../../src/endpoints/groupFederation.mjs'
import { broadcastHubGroupJoined } from '../../src/hubBroadcast.mjs'
import { resolvePowForJoin } from '../../src/powJoin.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'
import {
	setPinsBookmarksWrapVisible,
	setSyncBanner,
	updateStatusBanners,
} from '../banners.mjs'
import { warmCharEntityHashCache } from '../core/domUtils.mjs'
import { store, setState } from '../core/state.mjs'
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
	/** @type {{ federationActive?: boolean, wantIds: number, eventsFilled: number, wantIdsStillMissing: number, wantIdsRateLimited: boolean, tipsCollected?: number, peerRosterSize: number }} */
	let catchup
	try {
		catchup = await federationCatchUp(groupId, { waitMs: options.waitMs ?? 1400 })
	}
	catch (error) {
		setSyncBanner(true, { i18nKey: 'chat.hub.sync.failed', params: { error: handleError('chat.hub.sync.failed')(error).message } })
		return
	}

	if (store.context.currentGroupId === groupId && store.context.currentChannelId) {
		setState('context.currentState', await getGroupState(groupId))
		const { loadMessages } = await import('../messages/messages.mjs')
		await loadMessages()
	}

	if (!catchup.federationActive) {
		setSyncBanner(false)
		return
	}
	const stillMissing = Number(catchup.wantIdsStillMissing) || 0
	if (catchup.wantIdsRateLimited)
		setSyncBanner(true, { i18nKey: 'chat.hub.sync.rateLimited' })
	else if (stillMissing > 0)
		setSyncBanner(true, {
			i18nKey: 'chat.hub.sync.incomplete',
			params: { missing: stillMissing, total: catchup.wantIds },
		})
	// 勿用 tipsCollected===0 代替「无邻居」：邻居在线但 tip 已对齐 / ping 窗口内未回 pong 时 tips 也可为 0，
	// 而 live 发信仍走当时 roster——否则会出现「能互发却钉死无邻居横幅」。
	else if (catchup.peerRosterSize === 0)
		setSyncBanner(true, { i18nKey: 'chat.hub.sync.noPeers' })
	else
		setSyncBanner(false)
}

/**
 * 无法从本地 state 判定 joinPolicy 时，经联邦 pow-challenge 确认群是否为 pow 并解算入群 PoW。
 * 非 pow 群（invite-only / open）的 challenge 返回 404 → null，调用方继续走邀请码路径。
 * @param {string} groupId 群 ID
 * @param {string} joinerNodeHash 入群者 nodeHash
 * @param {string | null | undefined} introducerNodeHash 优先定向的引入者节点
 * @returns {Promise<object | null>} PoW 解；群非 pow 或 challenge 不可用时 null
 */
async function resolvePowViaChallenge(groupId, joinerNodeHash, introducerNodeHash) {
	const challenge = await getPowChallenge(groupId, { introducerNodeHash }).catch(() => null)
	if (!challenge?.anchors?.length) return null
	return resolvePowForJoin(groupId, null, joinerNodeHash, challenge)
}

/**
 * @param {object} state 群状态
 * @param {{ inviteCode?: string | null, fedBootstrap?: object | null }} pendingJoin session 待消费邀请
 * @param {string | null} inviteCode URL 或 pending 邀请码
 * @returns {boolean} 是否应自动尝试入群
 */
function canAutoJoinGroup(state, pendingJoin, inviteCode) {
	if (state.isMember) return false
	if (state.replicaRetained) return false
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
	const { mountTemplate } = await import('../../src/templates.mjs')
	setState('context.currentChannelId', null)
	updateHash(store.context.currentGroupId, null)
	disableComposer()
	await mountTemplate(document.getElementById('messages'), 'hub/empty/error', {
		i18nKey: 'chat.hub.group.joinRequired',
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
		// pow discovery 群：无本地 replica / invite / fedBootstrap，动态申请 challenge 解 pow 入群。
		const challenge = await getPowChallenge(groupId).catch(() => null)
		if (challenge?.anchors?.length) {
			const pow = await resolvePowForJoin(groupId, null, store.viewer.nodeHash || '', challenge)
			await joinGroup(groupId, null, null, pow, {
				roomSecret: challenge.roomSecret,
				signalingAppId: challenge.signalingAppId,
				introducerNodeHash: challenge.responderNodeHash || null,
				introducerPubKeyHash: null,
			})
			const joined = await getGroupState(groupId)
			broadcastHubGroupJoined(groupId)
			await loadGroups()
			return joined
		}
		setState('context.currentState', state)
		store.context.currentMode = 'groups'
		document.querySelectorAll('.server-item[data-mode]').forEach(el => {
			el.classList.toggle('mode-active', el.dataset.mode === 'groups')
		})
		const groupNameElement = document.getElementById('group-name-display')
		groupNameElement.textContent = ''
		groupNameElement.dataset.i18n = 'chat.hub.group.tag'
		await renderChannelList(state)
		await renderMemberList(state)
		await renderGroupInfoCard(state)
		await showGroupJoinRequiredState()
		const { refreshHubHeaderButtons } = await import('../messages/composerController.mjs')
		refreshHubHeaderButtons()
		return null
	}
	// 本地已有 replica 且已知为 pow 群：直接用本地锚解 pow；
	// 否则回退到联邦 pow-challenge 判定——群已改为 pow 而持有改策略前旧邀请码时，
	// 无本地 replica 的 joinPolicy 是默认 invite-only，只带 inviteCode 不带 powSolution 会被 owner 入站拒绝。
	let pow = state?.groupSettings?.joinPolicy === 'pow'
		? await resolvePowForJoin(groupId, state, store.viewer.nodeHash || '', pendingJoin.fedBootstrap)
		: null
	if (!pow)
		pow = await resolvePowViaChallenge(groupId, store.viewer.nodeHash || '', pendingJoin.fedBootstrap?.introducerNodeHash)
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
	setState('context.currentState', state)
	// 先等分区房间重绑，再 catch-up；否则 tip ping 打在空 roster 上，横幅误报无邻居。
	await rebindFederationRoomQuiet(groupId, {
		channelId: presetChannelId || state.groupSettings?.defaultChannelId || null,
	})
	void warmCharEntityHashCache()
	if (state.viewerEntityHash)
		store.viewer.viewerEntityHash = state.viewerEntityHash
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
		setState('context.currentState', state)
	}
	return state
}
