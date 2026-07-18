import { pauseAllSocialVideos } from './lib/videoAutoplay.mjs'

/** 可写入 location.hash 的主导航视图 */
export const MAIN_NAV_VIEWS = Object.freeze([
	'feed', 'explore', 'notifications', 'saved', 'drafts', 'profile', 'videos', 'live', 'settings',
])

/** 二级视图 → 保留高亮的主导航 */
const OVERLAY_PARENT = Object.freeze({
	settings: 'profile',
	search: 'feed',
	topic: 'explore',
	postDetail: 'feed',
	liveBroadcast: 'live',
})

/** @type {string | null} 当前激活的主导航视图名 */
let activeMainView = null

/**
 * @returns {string | null} 当前主导航视图
 */
export function currentMainView() {
	return activeMainView
}

/**
 * 切换主导航视图的高亮与可见性。
 * @param {string} view 视图名（feed / explore / profile / …）
 * @returns {void}
 */
export function activateView(view) {
	activeMainView = view
	const highlight = OVERLAY_PARENT[view] || view
	for (const button of document.querySelectorAll('.nav-btn'))
		button.classList.toggle('active', button.dataset.view === highlight)
	for (const section of document.querySelectorAll('.view')) {
		const show = section.id === `${view}View`
		section.classList.toggle('hidden', !show)
		if (!show) pauseAllSocialVideos(section)
	}
	document.getElementById('composer')?.classList.toggle('hidden', view !== 'feed')
}
