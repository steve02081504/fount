/** 可写入 location.hash 的主导航视图 */
export const MAIN_NAV_VIEWS = Object.freeze([
	'feed', 'explore', 'notifications', 'saved', 'taste', 'profile', 'videos', 'live',
])

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
	for (const button of document.querySelectorAll('.nav-btn'))
		button.classList.toggle('active', button.dataset.view === view)
	for (const section of document.querySelectorAll('.view'))
		section.classList.add('hidden')
	document.getElementById(`${view}View`)?.classList.remove('hidden')
	document.getElementById('composer')?.classList.toggle('hidden', view !== 'feed')
}
