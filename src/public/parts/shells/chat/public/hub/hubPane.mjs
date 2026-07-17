/**
 * 【文件】public/hub/hubPane.mjs
 * 【职责】移动端单栏布局状态：导航屏（nav）⇄ 会话屏（main），写在 body[data-hub-pane]。
 * 【原理】≤768px CSS 消费该属性；桌面宽度下规则不生效，无需 matchMedia。
 */

/**
 * @param {'nav' | 'main'} pane 目标屏
 * @returns {void}
 */
export function setHubPane(pane) {
	document.body.dataset.hubPane = pane
	if (pane === 'nav')
		document.getElementById('hub-member-bar')?.classList.remove('hub-member-bar--open')
}

/** @returns {'nav' | 'main'} 当前屏 */
export function getHubPane() {
	return document.body.dataset.hubPane === 'main' ? 'main' : 'nav'
}

/** 进入会话主屏。 @returns {void} */
export function showHubMainPane() {
	setHubPane('main')
}

/** 回到导航屏（服务器栏 + 频道栏）。 @returns {void} */
export function showHubNavPane() {
	setHubPane('nav')
}
