/**
 * Hub 横幅与固定 DOM 节点的声明式绑定（订阅 store / watchState）。
 */
import { getGroupState } from '../../src/api/groupCore.mjs'

import { store, setState, watchState } from './state.mjs'

/** @typedef {{
 *   id: string
 *   textId?: string
 *   visible: () => boolean
 *   i18n?: () => string
 *   dataset?: () => Record<string, string>
 * }} BannerBinding */

/** @returns {boolean} 是否显示明文侧车横幅 */
function plaintextBannerVisible() {
	const channel = store.context.currentState?.channels?.[store.context.currentChannelId]
	return store.context.currentMode === 'groups'
		&& !!store.context.currentGroupId
		&& !!store.context.currentState?.isMember
		&& channel?.syncScope === 'channel'
}

/** @returns {string} i18n 键 */
function plaintextBannerI18n() {
	return 'chat.hub.banners.plaintextSidecar'
}

/** @returns {boolean} 是否显示隔离区横幅 */
function quarantineBannerVisible() {
	const count = Number(store.context.currentState?.quarantineCount) || 0
	return store.context.currentMode === 'groups'
		&& !!store.context.currentGroupId
		&& !!store.context.currentState?.isMember
		&& count > 0
}

/** @returns {string} i18n 键 */
function quarantineBannerI18n() {
	return 'chat.hub.banners.quarantine'
}

/** @returns {Record<string, string>} dataset 插值 */
function quarantineBannerDataset() {
	return { count: String(Number(store.context.currentState?.quarantineCount) || 0) }
}

/** @returns {boolean} 是否显示 GSH 缓冲横幅 */
function gshBufferBannerVisible() {
	const total = Number(store.context.currentState?.gshBuffer?.total) || 0
	return store.context.currentMode === 'groups'
		&& !!store.context.currentGroupId
		&& !!store.context.currentState?.isMember
		&& total > 0
}

/** @returns {string} i18n 键 */
function gshBufferBannerI18n() {
	return 'chat.hub.banners.gshBuffer'
}

/** @returns {Record<string, string>} dataset 插值 */
function gshBufferBannerDataset() {
	return { total: String(Number(store.context.currentState?.gshBuffer?.total) || 0) }
}

/** @returns {boolean} 是否显示冷归档缺口横幅 */
function archiveCoverageBannerVisible() {
	const coverage = store.context.currentState?.archiveCoverage?.channels || {}
	const hasKnownGap = Object.values(coverage).some(row => row?.complete === false)
	return store.context.currentMode === 'groups'
		&& !!store.context.currentGroupId
		&& !!store.context.currentState?.isMember
		&& hasKnownGap
}

/** @returns {string} i18n 键 */
function archiveCoverageBannerI18n() {
	return 'chat.hub.banners.archiveCoverageIncomplete'
}

/** @returns {boolean} 是否显示联邦同步横幅 */
function syncBannerVisible() {
	return !!store.federation.syncBanner?.visible
}

/** @returns {string} i18n 键 */
function syncBannerI18n() {
	return store.federation.syncBanner?.i18nKey || 'chat.hub.banners.syncing'
}

/** @returns {Record<string, string>} dataset 插值 */
function syncBannerDataset() {
	/** @type {Record<string, string>} */
	const out = {}
	for (const [k, v] of Object.entries(store.federation.syncBanner?.params || {}))
		out[k] = String(v)
	return out
}

/** @returns {boolean} 是否显示疑似被移出横幅 */
function shunRemovedBannerVisible() {
	return store.context.currentMode === 'groups'
		&& !!store.context.currentGroupId
		&& !!store.context.currentState?.suspectedRemoved
		&& !store.context.currentState?.shunBannerDismissed
}

/** @returns {string} i18n 键 */
function shunRemovedBannerI18n() {
	return 'chat.hub.banners.suspectedRemoved'
}

/** @returns {Record<string, string>} dataset 插值 */
function shunRemovedBannerDataset() {
	const count = Array.isArray(store.context.currentState?.shunnedBy)
		? store.context.currentState.shunnedBy.length
		: 0
	return { count: String(count) }
}

/** @returns {boolean} 是否显示本地视图分叉横幅 */
function localViewBannerVisible() {
	const consensus = store.context.currentState?.consensusBranchTip || ''
	const localView = store.context.currentState?.localViewBranchTip || ''
	return store.context.currentMode === 'groups'
		&& !!store.context.currentGroupId
		&& !!store.context.currentState?.isMember
		&& !!localView && !!consensus && localView !== consensus
}

/** @type {BannerBinding[]} */
const BANNER_BINDINGS = [
	{
		id: 'plaintext-main-banner',
		textId: 'plaintext-main-banner-text',
		visible: plaintextBannerVisible,
		i18n: plaintextBannerI18n,
	},
	{
		id: 'archive-coverage-banner',
		textId: 'archive-coverage-banner-text',
		visible: archiveCoverageBannerVisible,
		i18n: archiveCoverageBannerI18n,
	},
	{
		id: 'quarantine-banner',
		textId: 'quarantine-banner-text',
		visible: quarantineBannerVisible,
		i18n: quarantineBannerI18n,
		dataset: quarantineBannerDataset,
	},
	{
		id: 'group-state-host-buffer-banner',
		textId: 'group-state-host-buffer-banner-text',
		visible: gshBufferBannerVisible,
		i18n: gshBufferBannerI18n,
		dataset: gshBufferBannerDataset,
	},
	{
		id: 'local-view-banner',
		visible: localViewBannerVisible,
	},
	{
		id: 'sync-banner',
		textId: 'sync-banner-text',
		visible: syncBannerVisible,
		i18n: syncBannerI18n,
		dataset: syncBannerDataset,
	},
	{
		id: 'shun-removed-banner',
		textId: 'shun-removed-banner-text',
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
	const textElement = binding.textId ? document.getElementById(binding.textId) : null
	if (textElement && show) {
		if (binding.i18n) textElement.dataset.i18n = binding.i18n()
		if (binding.dataset) {
			for (const k of Object.keys(textElement.dataset))
				if (k !== 'i18n') delete textElement.dataset[k]
			for (const [k, v] of Object.entries(binding.dataset()))
				textElement.dataset[k] = v
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
	watchState('context.currentGroupId', refreshBoundBanners)
	watchState('context.currentChannelId', refreshBoundBanners)
	watchState('context.currentState', refreshBoundBanners)
	document.getElementById('archive-sync-button')?.addEventListener('click', () => {
		const groupId = store.context.currentGroupId
		if (!groupId) return
		void fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/archive/sync`, {
			method: 'POST',
			credentials: 'include',
		}).then(async () => {
			setState('context.currentState', await getGroupState(groupId))
			refreshBoundBanners()
		}).catch(console.error)
	})
	document.getElementById('shun-keep-history-button')?.addEventListener('click', () => {
		const groupId = store.context.currentGroupId
		if (!groupId) return
		void fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/federation/shun-dismiss`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: '{}',
		}).then(async () => {
			setState('context.currentState', await getGroupState(groupId))
			refreshBoundBanners()
		}).catch(console.error)
	})
	document.getElementById('shun-leave-button')?.addEventListener('click', () => {
		const groupId = store.context.currentGroupId
		if (!groupId) return
		void import('../groupContextMenu.mjs').then(({ leaveGroupsOptimistic }) =>
			leaveGroupsOptimistic([groupId]),
		).catch(console.error)
	})
	refreshBoundBanners()
}
