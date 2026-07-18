/**
 * 【文件】public/hub/banners.mjs
 * 【职责】Hub 顶栏与主区横幅：置顶/书签侧栏显隐、明文模式提示、DAG 分叉横幅与频道置顶条刷新。
 * 【原理】操作 `#pins-bookmarks-wrap`、`#plaintext-main-banner`、`#dag-fork-banner` 等固定占位元素。`refreshChannelPinsBar` 根据置顶事件更新顶栏摘要，与 `pinPreview` 协作展示引用预览。
 * 【数据结构】store 及模块内 Map/Set 字段；见 core/state 与各函数 JSDoc。
 * 【关联】../../../../scripts/template、fount-p2p/core/hexIds、core/domUtils、core/state
 */
import { isHex64 } from 'https://esm.sh/@steve02081504/fount-p2p/core/hexIds'

import { renderTemplateAsHtmlString } from '../../../../scripts/features/template.mjs'

import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { refreshBoundBanners } from './core/bindings.mjs'
import { store } from './core/state.mjs'

/**
 * 显示或隐藏顶栏的置顶/书签弹出按钮（搜索栏左侧）。
 * @param {boolean} on 是否显示
 * @returns {void} 无
 */
export function setPinsBookmarksWrapVisible(on) {
	for (const id of ['pins-pop', 'bookmarks-pop']) {
		const pop = document.getElementById(id)
		if (!pop) continue
		if (on) pop.removeAttribute('hidden')
		else {
			pop.setAttribute('hidden', '')
			pop.querySelector('.header-panel')?.setAttribute('hidden', '')
			const button = pop.querySelector('.header-pop-button')
			button?.classList.remove('is-open')
			button?.setAttribute('aria-expanded', 'false')
		}
	}
}

/** @returns {void} */
export function updatePlaintextMainBanner() {
	refreshBoundBanners()
}

/** @returns {void} */
export function refreshQuarantineBanner() {
	refreshBoundBanners()
}

/** @returns {Promise<void>} */
export async function refreshDagForkBanner() {
	const banner = document.getElementById('fork-banner')
	const textElement = document.getElementById('fork-banner-text')
	const mergeButton = document.getElementById('fork-merge-button')
	const tipSelect = document.getElementById('fork-tip-select')
	if (!banner || !textElement) return
	if (store.context.currentMode !== 'groups' || !store.context.currentGroupId || !store.context.currentState?.isMember) {
		banner.setAttribute('hidden', '')
		store.federation.dagTips = []
		return
	}
	const response = await fetch(
		`/api/parts/shells:chat/groups/${encodeURIComponent(store.context.currentGroupId)}/dag/tips`,
		{ credentials: 'include' },
	)
	const data = await response.json()
	const tips = Array.isArray(data.tips) ? data.tips : []
	store.federation.dagTips = tips
	const governanceFork = !!data.governanceFork || !!store.context.currentState?.governanceFork
	if (tips.length < 2 && !governanceFork) {
		banner.setAttribute('hidden', '')
		return
	}
	banner.removeAttribute('hidden')
	textElement.dataset.i18n = governanceFork && tips.length < 2
		? 'chat.hub.banners.forkGovernance'
		: 'chat.hub.banners.forkTips'
	textElement.dataset.count = String(tips.length)
	if (mergeButton) mergeButton.disabled = tips.length < 2
	refreshLocalViewBanner()
	if (tipSelect) {
		const preferred = data.consensusBranchTip || store.context.currentState?.consensusBranchTip || ''
		const tipConsensusScores = data.tipConsensusScores || {}
		if (!tips.length)
			tipSelect.innerHTML = ''
		else {
			const tipRows = tips.map(id => {
				const short = id.length > 12 ? `${id.slice(0, 10)}…` : id
				const score = Number(tipConsensusScores[id])
				return {
					id: escapeHtml(id),
					short: escapeHtml(short),
					score: Number.isFinite(score) ? String(Math.floor(score)) : '',
					i18nKey: Number.isFinite(score) ? 'chat.hub.banners.forkTipScore' : '',
					selected: id === preferred,
				}
			})
			tipSelect.innerHTML = await renderTemplateAsHtmlString('hub/banners/fork_tip_options', { tips: tipRows })
		}
		const current = tipSelect.value
		if (current && [...tipSelect.options].some(opt => opt.value === current)) tipSelect.value = current
	}
}

/**
 * 联邦同步进度横幅。
 * @param {boolean} on 是否显示
 * @param {{ i18nKey?: string, params?: Record<string, string | number> }} [options] `data-i18n` 键与 dataset 插值
 * @returns {void}
 */
export function setSyncBanner(on, options) {
	store.federation.syncBanner = {
		visible: on,
		i18nKey: options?.i18nKey || 'chat.hub.banners.syncing',
		params: options?.params || {},
	}
	refreshBoundBanners()
}

/**
 * 分叉 tip 下拉框当前选中值，无选中时回退到首个 tip。
 * @returns {string | undefined} 选中的 DAG tip id
 */
export function selectedForkTipId() {
	const value = document.getElementById('fork-tip-select')?.value?.trim().toLowerCase()
	if (isHex64(value)) return value
	return store.federation.dagTips[0]
}

/** @returns {Promise<void>} */
export async function refreshChannelPinsBar() {
	const bar = document.getElementById('channel-pins-bar')
	if (!bar) return
	if (store.context.currentMode !== 'groups' || !store.context.currentGroupId || !store.context.currentChannelId) {
		bar.setAttribute('hidden', '')
		bar.innerHTML = ''
		return
	}
	const ids = store.context.currentState?.pinsByChannel?.[store.context.currentChannelId]
	if (!Array.isArray(ids) || !ids.length) {
		bar.setAttribute('hidden', '')
		bar.innerHTML = ''
		return
	}
	bar.removeAttribute('hidden')
	const pins = ids.map(eventId => {
		const short = eventId.length > 10 ? `${eventId.slice(0, 8)}…` : eventId
		return { eventId: escapeHtml(eventId), short: escapeHtml(short) }
	})
	bar.innerHTML = await renderTemplateAsHtmlString('hub/banners/pins_chips', { pins })
	bar.querySelectorAll('.pinned-message-chip').forEach(pinChip => {
		pinChip.addEventListener('click', () => {
			document.querySelector(`#messages [data-message-id="${pinChip.getAttribute('data-pinned-message-event')}"]`)
				?.scrollIntoView({ block: 'center', behavior: 'smooth' })
		})
	})
}

/** @returns {void} */
export function refreshGshBufferBanner() {
	refreshBoundBanners()
}

/** @returns {void} */
export function refreshLocalViewBanner() {
	refreshBoundBanners()
}

/** @returns {void} */
export function updateStatusBanners() {
	updatePlaintextMainBanner()
	refreshGshBufferBanner()
	refreshQuarantineBanner()
	refreshLocalViewBanner()
	void refreshChannelPinsBar()
	void refreshDagForkBanner().then(() => refreshLocalViewBanner())
}
