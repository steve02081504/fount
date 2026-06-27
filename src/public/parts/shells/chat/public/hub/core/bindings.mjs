/**
 * Hub 横幅与固定 DOM 节点的声明式绑定（订阅 hubStore / watchHubState）。
 */
import { getGroupState } from '../../src/api/groupApi.mjs'
import { getMailboxPendingCount, refreshMailboxPendingCount } from '../hubNotifications.mjs'

import { hubStore, setHubState, watchHubState } from './state.mjs'

/** @typedef {{
 *   id: string
 *   textId?: string
 *   visible: () => boolean
 *   i18n?: () => string
 *   dataset?: () => Record<string, string>
 * }} BannerBinding */

/** @returns {boolean} 是否显示明文侧车横幅 */
function plaintextBannerVisible() {
	const channel = hubStore.currentState?.channels?.[hubStore.currentChannelId]
	return hubStore.currentMode === 'groups'
		&& !!hubStore.currentGroupId
		&& !!hubStore.currentState?.isMember
		&& channel?.syncScope === 'channel'
}

/** @returns {string} i18n 键 */
function plaintextBannerI18n() {
	return 'chat.hub.banners.plaintextSidecar'
}

/** @returns {boolean} 是否显示隔离区横幅 */
function quarantineBannerVisible() {
	const count = Number(hubStore.currentState?.quarantineCount) || 0
	return hubStore.currentMode === 'groups'
		&& !!hubStore.currentGroupId
		&& !!hubStore.currentState?.isMember
		&& count > 0
}

/** @returns {string} i18n 键 */
function quarantineBannerI18n() {
	return 'chat.hub.banners.quarantine'
}

/** @returns {Record<string, string>} dataset 插值 */
function quarantineBannerDataset() {
	return { count: String(Number(hubStore.currentState?.quarantineCount) || 0) }
}

/** @returns {boolean} 是否显示 GSH 缓冲横幅 */
function gshBufferBannerVisible() {
	const total = Number(hubStore.currentState?.gshBuffer?.total) || 0
	return hubStore.currentMode === 'groups'
		&& !!hubStore.currentGroupId
		&& !!hubStore.currentState?.isMember
		&& total > 0
}

/** @returns {string} i18n 键 */
function gshBufferBannerI18n() {
	return 'chat.hub.banners.gshBuffer'
}

/** @returns {Record<string, string>} dataset 插值 */
function gshBufferBannerDataset() {
	return { total: String(Number(hubStore.currentState?.gshBuffer?.total) || 0) }
}

/** @returns {boolean} 是否显示邮箱待处理横幅 */
function mailboxBannerVisible() {
	return (Number(hubStore.mailboxPendingCount) || 0) > 0
}

/** @returns {string} i18n 键 */
function mailboxBannerI18n() {
	return 'chat.hub.banners.mailboxPending'
}

/** @returns {Record<string, string>} dataset 插值 */
function mailboxBannerDataset() {
	return { count: String(Number(hubStore.mailboxPendingCount) || 0) }
}

/** @returns {boolean} 是否显示冷归档缺口横幅 */
function archiveCoverageBannerVisible() {
	const coverage = hubStore.currentState?.archiveCoverage?.channels || {}
	const hasKnownGap = Object.values(coverage).some(row => row?.complete === false)
	return hubStore.currentMode === 'groups'
		&& !!hubStore.currentGroupId
		&& !!hubStore.currentState?.isMember
		&& hasKnownGap
}

/** @returns {string} i18n 键 */
function archiveCoverageBannerI18n() {
	return 'chat.hub.banners.archiveCoverageIncomplete'
}

/** @returns {boolean} 是否显示联邦同步横幅 */
function syncBannerVisible() {
	return !!hubStore.syncBanner?.visible
}

/** @returns {string} i18n 键 */
function syncBannerI18n() {
	return hubStore.syncBanner?.i18nKey || 'chat.hub.banners.syncing'
}

/** @returns {Record<string, string>} dataset 插值 */
function syncBannerDataset() {
	/** @type {Record<string, string>} */
	const out = {}
	for (const [k, v] of Object.entries(hubStore.syncBanner?.params || {}))
		out[k] = String(v)
	return out
}

/** @returns {boolean} 是否显示疑似被移出横幅 */
function shunRemovedBannerVisible() {
	return hubStore.currentMode === 'groups'
		&& !!hubStore.currentGroupId
		&& !!hubStore.currentState?.suspectedRemoved
		&& !hubStore.currentState?.shunBannerDismissed
}

/** @returns {string} i18n 键 */
function shunRemovedBannerI18n() {
	return 'chat.hub.banners.suspectedRemoved'
}

/** @returns {Record<string, string>} dataset 插值 */
function shunRemovedBannerDataset() {
	const count = Array.isArray(hubStore.currentState?.shunnedBy)
		? hubStore.currentState.shunnedBy.length
		: 0
	return { count: String(count) }
}

/** @returns {boolean} 是否显示本地视图分叉横幅 */
function localViewBannerVisible() {
	const consensus = hubStore.currentState?.consensusBranchTip || ''
	const localView = hubStore.currentState?.localViewBranchTip || ''
	return hubStore.currentMode === 'groups'
		&& !!hubStore.currentGroupId
		&& !!hubStore.currentState?.isMember
		&& !!localView && !!consensus && localView !== consensus
}

/** @type {BannerBinding[]} */
const BANNER_BINDINGS = [
	{
		id: 'hub-plaintext-main-banner',
		textId: 'hub-plaintext-main-banner-text',
		visible: plaintextBannerVisible,
		i18n: plaintextBannerI18n,
	},
	{
		id: 'hub-archive-coverage-banner',
		textId: 'hub-archive-coverage-banner-text',
		visible: archiveCoverageBannerVisible,
		i18n: archiveCoverageBannerI18n,
	},
	{
		id: 'hub-quarantine-banner',
		textId: 'hub-quarantine-banner-text',
		visible: quarantineBannerVisible,
		i18n: quarantineBannerI18n,
		dataset: quarantineBannerDataset,
	},
	{
		id: 'hub-group-state-host-buffer-banner',
		textId: 'hub-group-state-host-buffer-banner-text',
		visible: gshBufferBannerVisible,
		i18n: gshBufferBannerI18n,
		dataset: gshBufferBannerDataset,
	},
	{
		id: 'hub-local-view-banner',
		visible: localViewBannerVisible,
	},
	{
		id: 'hub-mailbox-banner',
		textId: 'hub-mailbox-banner-text',
		visible: mailboxBannerVisible,
		i18n: mailboxBannerI18n,
		dataset: mailboxBannerDataset,
	},
	{
		id: 'hub-sync-banner',
		textId: 'hub-sync-banner-text',
		visible: syncBannerVisible,
		i18n: syncBannerI18n,
		dataset: syncBannerDataset,
	},
	{
		id: 'hub-shun-removed-banner',
		textId: 'hub-shun-removed-banner-text',
		visible: shunRemovedBannerVisible,
		i18n: shunRemovedBannerI18n,
		dataset: shunRemovedBannerDataset,
	},
]

/**
 * @param {BannerBinding} binding 绑定配置
 * @returns {void}
 */
function applyBannerBinding(binding) {
	const el = document.getElementById(binding.id)
	if (!el) return
	const show = binding.visible()
	if (show) el.removeAttribute('hidden')
	else el.setAttribute('hidden', '')
	const textEl = binding.textId ? document.getElementById(binding.textId) : null
	if (textEl && show) {
		if (binding.i18n) textEl.dataset.i18n = binding.i18n()
		if (binding.dataset) {
			for (const k of Object.keys(textEl.dataset))
				if (k !== 'i18n') delete textEl.dataset[k]
			for (const [k, v] of Object.entries(binding.dataset()))
				textEl.dataset[k] = v
		}
	}
}

/** @returns {void} */
export function refreshBoundBanners() {
	for (const binding of BANNER_BINDINGS)
		applyBannerBinding(binding)
}

let wired = false

/** @returns {void} */
export function wireHubBannerBindings() {
	if (wired) return
	wired = true
	watchHubState('currentGroupId', refreshBoundBanners)
	watchHubState('currentChannelId', refreshBoundBanners)
	watchHubState('currentState', refreshBoundBanners)
	document.getElementById('hub-archive-sync-btn')?.addEventListener('click', () => {
		const groupId = hubStore.currentGroupId
		if (!groupId) return
		void fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/archive/sync`, {
			method: 'POST',
			credentials: 'include',
		}).then(async () => {
			setHubState('currentState', await getGroupState(groupId))
			refreshBoundBanners()
		}).catch(console.error)
	})
	document.getElementById('hub-shun-keep-history-btn')?.addEventListener('click', () => {
		const groupId = hubStore.currentGroupId
		if (!groupId) return
		void fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/federation/shun-dismiss`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: '{}',
		}).then(async () => {
			setHubState('currentState', await getGroupState(groupId))
			refreshBoundBanners()
		}).catch(console.error)
	})
	document.getElementById('hub-shun-leave-btn')?.addEventListener('click', () => {
		const groupId = hubStore.currentGroupId
		if (!groupId) return
		void import('../groupContextMenu.mjs').then(({ leaveGroupsOptimistic }) =>
			leaveGroupsOptimistic([groupId]),
		).catch(console.error)
	})
	refreshBoundBanners()
}

/**
 * 邮箱横幅（异步计数，保留在 banners.mjs 调用）。
 * @returns {Promise<void>}
 */
export async function refreshMailboxBannerBound() {
	await refreshMailboxPendingCount()
	hubStore.mailboxPendingCount = getMailboxPendingCount()
	refreshBoundBanners()
}
