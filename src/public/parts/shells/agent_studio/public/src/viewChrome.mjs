/**
 * 【文件】public/src/viewChrome.mjs — 主视图切换与导航高亮
 * 【职责】记录当前主视图，切换视图区块显隐，并同步侧栏 / 移动端底栏的激活态。
 * 【原理】视图约定为 `<section id="<view>View" class="view">`；导航按钮携带 `data-view`。
 * 【关联】navigation.mjs、index.html。
 */

/** 可写入 location.hash 的主导航视图。 */
export const MAIN_NAV_VIEWS = ['dashboard', 'generations', 'benchmarks', 'settings']

/** @type {string} 当前激活的主导航视图名 */
let activeMainView = ''

/**
 * 读取当前主视图。
 * @returns {string} 当前主视图名
 */
export function currentMainView() {
	return activeMainView
}

/**
 * 切换主导航高亮与视图显隐。
 * @param {string} view 视图名（dashboard / generations / benchmarks / settings）
 * @returns {void}
 */
export function activateView(view) {
	activeMainView = view
	for (const button of document.querySelectorAll('.nav-btn[data-view]')) {
		const active = button.dataset.view === view
		button.classList.toggle('active', active)
		button.classList.toggle('dock-active', active)
		if (active) button.setAttribute('aria-current', 'page')
		else button.removeAttribute('aria-current')
	}
	for (const section of document.querySelectorAll('.view'))
		section.classList.toggle('hidden', section.id !== `${view}View`)
}
