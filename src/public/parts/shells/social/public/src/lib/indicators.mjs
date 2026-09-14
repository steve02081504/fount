/**
 * 滑动指示器：把活动项的实测几何写进 CSS 变量（`--ti-x/y/w/h/sx/sy`），
 * 由样式表消费做合成友好的 `translate` 过渡。导航（纵向侧栏 / 横向 dock）
 * 与资料页 tab 共用。几何在注册的 CSS 更新器中随窗口 / 内容变动自动重测。
 */
import { registerCssUpdater } from '/scripts/lib/cssValues.mjs'

/** 侧栏导航轨道选择器。 */
const SIDE_TRACK = '.side-nav-links'
/** 移动端 dock 轨道选择器。 */
const DOCK_TRACK = '.mobile-tabbar'
/** 资料页 tab 轨道选择器。 */
const PROFILE_TRACK = '.profile-tabs'

/** 指示器元素类名（各轨道各自的视觉）。 */
const INDICATOR_CLASS = {
	[SIDE_TRACK]: 'nav-indicator',
	[DOCK_TRACK]: 'dock-indicator',
	[PROFILE_TRACK]: 'profile-tab-indicator',
}

/**
 * 确保轨道内存在指示器元素。
 * @param {HTMLElement} track 轨道
 * @param {string} className 指示器类名
 * @returns {HTMLElement} 指示器
 */
function ensureIndicator(track, className) {
	let indicator = track.querySelector(`:scope > .${className}`)
	if (!indicator) {
		indicator = document.createElement('span')
		indicator.className = className
		indicator.setAttribute('aria-hidden', 'true')
		track.prepend(indicator)
	}
	return indicator
}

/**
 * 把活动项几何写入指示器的 CSS 变量。
 * @param {HTMLElement} indicator 指示器
 * @param {HTMLElement} item 活动项
 * @param {HTMLElement} track 轨道
 * @returns {void}
 */
function measureIndicator(indicator, item, track) {
	const trackWidth = track.clientWidth
	const trackHeight = track.clientHeight
	indicator.classList.remove('hidden')
	indicator.style.setProperty('--ti-x', `${item.offsetLeft}px`)
	indicator.style.setProperty('--ti-y', `${item.offsetTop}px`)
	indicator.style.setProperty('--ti-w', `${item.offsetWidth}px`)
	indicator.style.setProperty('--ti-h', `${item.offsetHeight}px`)
	indicator.style.setProperty('--ti-sx', String(trackWidth ? item.offsetWidth / trackWidth : 1))
	indicator.style.setProperty('--ti-sy', String(trackHeight ? item.offsetHeight / trackHeight : 1))
}

/**
 * 重测一条导航轨道的指示器位置。
 * @param {string} selector 轨道选择器
 * @returns {void}
 */
function refreshNavTrack(selector) {
	const track = document.querySelector(selector)
	if (!(track instanceof HTMLElement) || !track.clientWidth) return
	const indicator = ensureIndicator(track, INDICATOR_CLASS[selector])
	const active = track.querySelector('.nav-btn.active')
	if (!(active instanceof HTMLElement)) {
		indicator.classList.add('hidden')
		return
	}
	measureIndicator(indicator, active, track)
}

/**
 * 重测侧栏与移动 dock 导航指示器。
 * @returns {void}
 */
export function refreshNavIndicator() {
	refreshNavTrack(SIDE_TRACK)
	refreshNavTrack(DOCK_TRACK)
}

/**
 * 重测资料页 tab 指示器。
 * @returns {void}
 */
export function refreshProfileTabIndicator() {
	const track = document.querySelector(PROFILE_TRACK)
	if (!(track instanceof HTMLElement) || !track.clientWidth) return
	const indicator = ensureIndicator(track, INDICATOR_CLASS[PROFILE_TRACK])
	const active = track.querySelector('.profile-tab.active')
	if (!(active instanceof HTMLElement)) {
		indicator.classList.add('hidden')
		return
	}
	measureIndicator(indicator, active, track)
}

/**
 * 注册指示器：布局变化（窗口 / DOM / 尺寸）时自动重测。
 * @returns {void}
 */
export function initIndicators() {
	// 只观察 class：指示器自身写入的 style 不应触发重测，否则会形成每帧自激循环
	const observeOptions = { attributeFilter: ['class'] }
	registerCssUpdater(refreshNavIndicator, { observe: [SIDE_TRACK, DOCK_TRACK], observeOptions })
	registerCssUpdater(refreshProfileTabIndicator, { observe: '#profileView', observeOptions })
}
